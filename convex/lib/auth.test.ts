// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import {
  AGENT_TOKEN,
  authSubject,
  seedAgentMember,
  seedAuthedMember,
  seedMember,
  seedProject,
  seedUser,
  stubAgentTokenEnv,
} from "../../test/convexSupport";
import { requireActor, requireAgentToken } from "./auth";

/**
 * 全公開関数の認証ゲート（Issue #1 PR2 / convex/lib/auth.ts）の結合・単体テスト。
 *
 * - requireActor/requireAgentToken は convex/lib/auth.ts が唯一のゲート実装であり、
 *   library 関数として直接検証する（lib/memberLink.test.ts と同方式・t.run 経由）。
 * - env（MCP_ACCESS_TOKEN 等）の組み合わせを精密に制御する必要がある fail-closed
 *   系のケースは、公開関数経由より直接呼び出しの方がセットアップが単純で
 *   意図が明確なため、こちらで検証する。
 * - 「全公開関数がゲートされているか」自体は各 *.test.ts（tasks/issues/members/
 *   projects/gitLinks/repositories）の各テストが認証済み identity 経由の呼び出しで
 *   間接的に固定しており、ここでは代表例（tasks.listByProject）で結線を確認する。
 */

const modules = import.meta.glob(["../**/*.ts", "!../**/*.test.ts"]);
const setup = () => convexTest(schema, modules);

afterEach(() => {
  vi.unstubAllEnvs();
});

// --- ブラウザ経路（accessToken なし） -----------------------------------------

describe("requireActor（ブラウザ経路）", () => {
  it("未認証で公開関数を呼ぶと ConvexError で拒否する（例: tasks.listByProject）", async () => {
    const t = setup();
    const project = await seedProject(t);

    await expect(
      t.query(api.tasks.listByProject, { project }),
    ).rejects.toThrowError("認証が必要です");
  });

  it("認証済みだが Member 未リンクでも query は閲覧できる（requireAuthed。全画面クラッシュにせず NoMembersNotice の案内へ落とすため）", async () => {
    const t = setup();
    const project = await seedProject(t);
    const userId = await seedUser(t, { email: "nobody@example.com" });
    const asUnlinked = t.withIdentity({ subject: authSubject(userId) });

    await expect(
      asUnlinked.query(api.tasks.listByProject, { project }),
    ).resolves.toEqual([]);
  });

  it("認証済みでも Member 未リンクなら mutation（actor が必要）は ConvexError で拒否する", async () => {
    const t = setup();
    const userId = await seedUser(t, { email: "nobody@example.com" });
    const asUnlinked = t.withIdentity({ subject: authSubject(userId) });

    await expect(
      asUnlinked.mutation(api.members.create, {
        name: "X",
        email: "x@example.com",
        role: "member",
      }),
    ).rejects.toThrowError("メンバー登録がありません");
  });

  it("認証済みで Member にリンクされていれば、その Member を actor として解決する", async () => {
    const t = setup();
    const { as, memberId } = await seedAuthedMember(t);

    const actor = await as.run((ctx) => requireActor(ctx));

    expect(actor._id).toBe(memberId);
  });
});

// --- createdBy の actor 強制（tasks.create / issues.create） ------------------

describe("createdBy の actor 強制（tasks.create / issues.create）", () => {
  it("createdBy を引数で指定する手段がない（スキーマにない余分な引数はバリデータが拒否する）", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t);
    const impostor = await seedMember(t, {
      name: "Impostor",
      email: "impostor@example.com",
    });

    // createdBy は公開 API から削除済み（PR2）。あえて渡して拒否されることを
    // 確認する（型は any で迂回し、ランタイムのバリデータ拒否を検証する）。
    const argsWithForbiddenCreatedBy = {
      project,
      title: "x",
      firstTask: { title: "t" },
      createdBy: impostor,
      // biome-ignore lint: intentional runtime-only probe of a removed field
    } as any;

    await expect(
      as.mutation(api.issues.create, argsWithForbiddenCreatedBy),
    ).rejects.toThrow(/Unexpected field `createdBy`/);
  });

  it("作成された Issue/Task の createdBy は常に呼び出し元の actor になる", async () => {
    const t = setup();
    const { as, memberId } = await seedAuthedMember(t);
    const project = await seedProject(t);

    const { issue, task } = await as.mutation(api.issues.create, {
      project,
      title: "課題",
      firstTask: { title: "タスク" },
    });

    expect(await t.run((ctx) => ctx.db.get(issue))).toMatchObject({
      createdBy: memberId,
    });
    expect(await t.run((ctx) => ctx.db.get(task))).toMatchObject({
      createdBy: memberId,
    });
  });
});

// --- MCP 経路（accessToken） --------------------------------------------------

describe("requireActor / requireAgentToken（MCP 経路）", () => {
  it("正しい token なら MCP_AGENT_EMAIL に対応する Member を actor として解決する", async () => {
    const t = setup();
    const { memberId } = await seedAgentMember(t, {
      email: "agent@example.com",
    });

    const actor = await t.run((ctx) => requireActor(ctx, AGENT_TOKEN));

    expect(actor._id).toBe(memberId);
  });

  it("誤った token は ConvexError で拒否する", async () => {
    const t = setup();
    await seedAgentMember(t);

    await expect(
      t.run((ctx) => requireActor(ctx, "wrong-token")),
    ).rejects.toThrowError("accessToken が一致しません");
  });

  it("MCP_ACCESS_TOKEN が未設定なら、空文字の accessToken でも一致させず拒否する（fail closed）", async () => {
    const t = setup();
    vi.stubEnv("MCP_ACCESS_TOKEN", undefined); // 未設定を明示する

    await expect(t.run((ctx) => requireActor(ctx, ""))).rejects.toThrowError(
      "MCP_ACCESS_TOKEN が設定されていません",
    );
  });

  it("MCP_ACCESS_TOKEN が空文字でも、空文字の accessToken と一致させず拒否する（fail closed・両方空の一致を通さない）", async () => {
    const t = setup();
    vi.stubEnv("MCP_ACCESS_TOKEN", "");

    await expect(t.run((ctx) => requireActor(ctx, ""))).rejects.toThrowError(
      "MCP_ACCESS_TOKEN が設定されていません",
    );
  });

  it("accessToken 自体が未指定なら MCP_ACCESS_TOKEN の設定有無に関わらずブラウザ経路として扱う", async () => {
    const t = setup();
    // MCP_ACCESS_TOKEN を設定していても、accessToken 未指定は MCP 経路に
    // 分岐しない（requireActor の `accessToken !== undefined` 分岐）。
    // ブラウザ経路として扱われ、未認証の getAuthUserId で拒否される。
    vi.stubEnv("MCP_ACCESS_TOKEN", AGENT_TOKEN);

    await expect(
      t.run((ctx) => requireActor(ctx, undefined)),
    ).rejects.toThrowError("認証が必要です");
  });

  it("MCP_AGENT_EMAIL の Member が未登録なら actionable な ConvexError を返す", async () => {
    const t = setup();
    stubAgentTokenEnv("agent@example.com"); // token だけ注入し、Member は seed しない

    await expect(
      t.run((ctx) => requireActor(ctx, AGENT_TOKEN)),
    ).rejects.toThrowError("エージェント Member が未登録です");
  });

  it("MCP_AGENT_EMAIL 自体が未設定なら actionable な ConvexError を返す", async () => {
    const t = setup();
    vi.stubEnv("MCP_ACCESS_TOKEN", AGENT_TOKEN);
    vi.stubEnv("MCP_AGENT_EMAIL", undefined);

    await expect(
      t.run((ctx) => requireActor(ctx, AGENT_TOKEN)),
    ).rejects.toThrowError("MCP_AGENT_EMAIL が設定されていません");
  });

  it("MCP_AGENT_EMAIL がメールアドレスとして不正なら拒否する（壊れた Member をサイレントに作らせない）", async () => {
    const t = setup();
    vi.stubEnv("MCP_ACCESS_TOKEN", AGENT_TOKEN);
    vi.stubEnv("MCP_AGENT_EMAIL", "agentexample.com"); // @ の付け忘れ

    await expect(
      t.run((ctx) => requireActor(ctx, AGENT_TOKEN)),
    ).rejects.toThrowError("メールアドレスとして不正");
    // ensureAgent（Member を作る唯一の経路）も同じ検証で弾く
    await expect(
      t.mutation(api.members.ensureAgent, { accessToken: AGENT_TOKEN }),
    ).rejects.toThrowError("メールアドレスとして不正");
  });

  it("requireAgentToken 単体でも同じ fail-closed 挙動になる（member 解決を伴わない検証専用パス）", async () => {
    vi.stubEnv("MCP_ACCESS_TOKEN", undefined);

    await expect(requireAgentToken(undefined)).rejects.toThrowError(
      "MCP_ACCESS_TOKEN が設定されていません",
    );
  });
});
