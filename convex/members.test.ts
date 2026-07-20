// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import {
  AGENT_TOKEN,
  authSubject,
  seedAgentMember,
  seedAuthedMember,
  seedMember,
  seedUser,
  stubAgentTokenEnv,
} from "../test/convexSupport";

/**
 * Member Core API の結合テスト（基本設計書 §3 / Issue #22 / Issue #1 PR2）。
 *
 * email の正規化・形式判定（normalizeEmail / isValidEmail）は
 * lib/validators.test.ts で単体検証済み。ここでは一意性（INVARIANT）の結線と、
 * list の PII 除外（未認証クライアントへ email を露出しない）、
 * および全公開関数の認証ゲート・MCP エージェント登録（ensureAgent）を検証する。
 */

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const setup = () => convexTest(schema, modules);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("members.create", () => {
  it("email を正規化（trim＋小文字化）して保存する", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);

    const { memberId } = await as.mutation(api.members.create, {
      name: "Alice2",
      email: "  Alice2@Example.COM ",
      role: "admin",
    });

    expect(await t.run((ctx) => ctx.db.get(memberId))).toMatchObject({
      name: "Alice2",
      email: "alice2@example.com", // 正規化済みの値で保存される
      role: "admin",
    });
  });

  it("招待トークンを返し、DB にはハッシュのみを保存する（平文は保存しない・招待ウィンドウ乗っ取り対策）", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);

    const { memberId, inviteToken } = await as.mutation(api.members.create, {
      name: "Bob",
      email: "bob@example.com",
      role: "member",
    });

    expect(inviteToken).toMatch(/^[0-9a-f]{64}$/);
    const stored = await t.run((ctx) => ctx.db.get(memberId));
    expect(stored?.inviteTokenHash).toBeDefined();
    expect(stored?.inviteTokenHash).not.toBe(inviteToken);
    expect(JSON.stringify(stored)).not.toContain(inviteToken);
  });

  it("正規化後に一致する email の重複を拒否し、Member を追加しない", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t, { email: "alice@example.com" });

    await expect(
      as.mutation(api.members.create, {
        name: "Impostor",
        email: " ALICE@example.com ", // 表記ゆれでも正規化後は同一
        role: "member",
      }),
    ).rejects.toThrowError(
      'メールアドレス "alice@example.com" は既に登録されています',
    );

    expect(await as.query(api.members.list, {})).toHaveLength(1);
  });

  it.each([
    { name: "@ がない", email: "plainaddress" },
    { name: "ドメインにドットがない", email: "a@b" },
    { name: "空白を含む", email: "a b@example.com" },
    { name: "ローカル部がない", email: "@example.com" },
    { name: "空文字", email: "" },
  ])('不正な email（$name: "$email"）を拒否する', async ({ email }) => {
    const t = setup();
    const { as } = await seedAuthedMember(t);

    await expect(
      as.mutation(api.members.create, { name: "x", email, role: "member" }),
    ).rejects.toThrowError("メールアドレスが不正です");
    // 既存の actor 本人（seedAuthedMember が作った1件）のみ
    expect(await as.query(api.members.list, {})).toHaveLength(1);
  });
});

describe("members.getByEmail", () => {
  it("表記ゆれの入力でも正規化して照合する", async () => {
    const t = setup();
    const { as, memberId: id } = await seedAuthedMember(t, {
      email: "alice@example.com",
    });

    const found = await as.query(api.members.getByEmail, {
      email: " Alice@EXAMPLE.com ",
    });

    expect(found).toMatchObject({ _id: id, email: "alice@example.com" });
  });

  it("未登録の email は null を返す", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);

    expect(
      await as.query(api.members.getByEmail, { email: "nobody@example.com" }),
    ).toBeNull();
  });
});

describe("members.list（PII 除外）", () => {
  it("_id と name のみ返し、email・role を露出しない", async () => {
    const t = setup();
    const { as, memberId: alice } = await seedAuthedMember(t, {
      name: "Alice",
      email: "alice@example.com",
    });
    const bob = await seedMember(t, { name: "Bob", email: "bob@example.com" });

    const listed = await as.query(api.members.list, {});

    // toEqual はキー集合まで厳密比較する＝email/role が漏れていればここで落ちる
    expect(listed).toEqual(
      expect.arrayContaining([
        { _id: alice, name: "Alice" },
        { _id: bob, name: "Bob" },
      ]),
    );
    expect(listed).toHaveLength(2);
  });
});

describe("members の認証ゲート（Issue #1 PR2）", () => {
  it("未認証の呼び出しは ConvexError で拒否する", async () => {
    const t = setup();
    await seedMember(t);

    await expect(t.query(api.members.list, {})).rejects.toThrowError(
      "認証が必要です",
    );
  });

  it("認証済みなら Member 未リンクでも query（list）は閲覧できる（requireAuthed。未リンク時の書き込み拒否は lib/auth.test.ts が固定する）", async () => {
    const t = setup();
    await seedMember(t);
    const userId = await seedUser(t, { email: "nobody@example.com" });
    const asUnlinked = t.withIdentity({ subject: authSubject(userId) });

    await expect(asUnlinked.query(api.members.list, {})).resolves.toHaveLength(
      1,
    );
  });
});

describe("members.ensureAgent（MCP エージェント Member の登録・Issue #1 PR2）", () => {
  it("正しい token で MCP_AGENT_EMAIL の Member を新規作成する", async () => {
    const t = setup();
    stubAgentTokenEnv("agent@example.com");

    const id = await t.mutation(api.members.ensureAgent, {
      accessToken: AGENT_TOKEN,
      name: "Agent Smith",
    });

    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
      name: "Agent Smith",
      email: "agent@example.com",
      role: "member",
    });
  });

  it("name 未指定なら email のローカル部を name として使う", async () => {
    const t = setup();
    stubAgentTokenEnv("botuser@example.com");

    const id = await t.mutation(api.members.ensureAgent, {
      accessToken: AGENT_TOKEN,
    });

    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
      name: "botuser",
      email: "botuser@example.com",
    });
  });

  it("2回目の呼び出しは同一 id を返し（冪等）、name を patch する", async () => {
    const t = setup();
    const { memberId } = await seedAgentMember(t, {
      name: "旧名",
      email: "agent@example.com",
    });

    const id = await t.mutation(api.members.ensureAgent, {
      accessToken: AGENT_TOKEN,
      name: "新名",
    });

    expect(id).toBe(memberId);
    expect(await t.run((ctx) => ctx.db.get(memberId))).toMatchObject({
      name: "新名",
      email: "agent@example.com",
    });
    expect(
      await t.run((ctx) => ctx.db.query("members").collect()),
    ).toHaveLength(1);
  });

  it("誤った token は拒否し、Member を作らない", async () => {
    const t = setup();
    stubAgentTokenEnv("agent@example.com");

    await expect(
      t.mutation(api.members.ensureAgent, { accessToken: "wrong-token" }),
    ).rejects.toThrowError("accessToken が一致しません");
    expect(
      await t.run((ctx) => ctx.db.query("members").collect()),
    ).toHaveLength(0);
  });
});

describe("members.me（Issue #1: 招待制リンクの照会）", () => {
  it("未認証なら null を返す", async () => {
    const t = setup();

    expect(await t.query(api.members.me, {})).toBeNull();
  });

  it("認証済みでも member にリンクされていなければ null を返す（email 一致では代替しない）", async () => {
    const t = setup();
    const userId = await seedUser(t, { email: "alice@example.com" });
    // 同じ email の member が存在していても、authUserId が未設定なら me は解決しない
    await seedMember(t, { email: "alice@example.com" });
    const asAlice = t.withIdentity({ subject: authSubject(userId) });

    expect(await asAlice.query(api.members.me, {})).toBeNull();
  });

  it("リンク済みなら _id・name・role・email を返す", async () => {
    const t = setup();
    const userId = await seedUser(t, { email: "alice@example.com" });
    const memberId = await seedMember(t, {
      name: "Alice",
      email: "alice@example.com",
      role: "admin",
      authUserId: userId,
    });
    const asAlice = t.withIdentity({ subject: authSubject(userId) });

    expect(await asAlice.query(api.members.me, {})).toEqual({
      _id: memberId,
      name: "Alice",
      role: "admin",
      email: "alice@example.com",
    });
  });
});
