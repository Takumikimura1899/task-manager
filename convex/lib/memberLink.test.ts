// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { seedMember, seedUser, type T } from "../../test/convexSupport";
import { linkAuthUserToMember } from "./memberLink";

/**
 * linkAuthUserToMember の結合テスト（Issue #1 PR1）。
 *
 * Convex Auth の users → 既存 members への招待制リンクを convex-test の
 * インメモリ DB を実物として通して検証する（内部モック禁止・古典学派）。
 * 呼び出し元（convex/auth.ts の afterUserCreatedOrUpdated）は結線のみなので、
 * ここでは t.run から直接この関数を呼ぶ。
 */

const modules = import.meta.glob(["../**/*.ts", "!../**/*.test.ts"]);
const setup = () => convexTest(schema, modules);

const getMember = (t: T, id: Id<"members">) => t.run((ctx) => ctx.db.get(id));

const findMemberByEmail = (t: T, email: string) =>
  t.run((ctx) =>
    ctx.db
      .query("members")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique(),
  );

const countMembers = async (t: T) =>
  (await t.run((ctx) => ctx.db.query("members").collect())).length;

describe("linkAuthUserToMember", () => {
  it("招待済み email の member に authUserId をリンクする", async () => {
    const t = setup();
    const memberId = await seedMember(t, { email: "alice@example.com" });
    const userId = await seedUser(t, { email: "alice@example.com" });

    await t.run((ctx) => linkAuthUserToMember(ctx, userId));

    expect(await getMember(t, memberId)).toMatchObject({ authUserId: userId });
  });

  it("同一 userId で再実行しても冪等（状態不変・エラーにならない）", async () => {
    const t = setup();
    const memberId = await seedMember(t, { email: "alice@example.com" });
    const userId = await seedUser(t, { email: "alice@example.com" });
    await t.run((ctx) => linkAuthUserToMember(ctx, userId));

    // t.run の返り値は Convex 値として直列化されるため undefined は null になる
    // （convex/lib/members.test.ts の同種の注記を参照）。ここでは throw しないことが本質。
    await expect(
      t.run((ctx) => linkAuthUserToMember(ctx, userId)),
    ).resolves.toBeNull();

    expect(await getMember(t, memberId)).toMatchObject({ authUserId: userId });
    expect(await countMembers(t)).toBe(1); // 二重リンクで member が増えていない
  });

  it("既に別 userId にリンク済みの member への横取りリンクを拒否する", async () => {
    const t = setup();
    const memberId = await seedMember(t, { email: "alice@example.com" });
    const firstUserId = await seedUser(t, { email: "alice@example.com" });
    await t.run((ctx) => linkAuthUserToMember(ctx, firstUserId));
    const secondUserId = await seedUser(t, { email: "alice@example.com" });

    await expect(
      t.run((ctx) => linkAuthUserToMember(ctx, secondUserId)),
    ).rejects.toThrowError(
      "このメールアドレスは既に別のアカウントで登録されています",
    );

    // 横取りされていない: リンクは最初の userId のまま
    expect(await getMember(t, memberId)).toMatchObject({
      authUserId: firstUserId,
    });
  });

  it("他の人間 member が存在する状態での未招待 email を拒否する（ブートストラップ対象外）", async () => {
    const t = setup();
    await seedMember(t, { email: "alice@example.com" });
    const userId = await seedUser(t, { email: "newcomer@example.com" });

    await expect(
      t.run((ctx) => linkAuthUserToMember(ctx, userId)),
    ).rejects.toThrowError("このメールアドレスは招待されていません");

    expect(await findMemberByEmail(t, "newcomer@example.com")).toBeNull();
    expect(await countMembers(t)).toBe(1); // 新規 member が作られていない
  });

  describe("初回ブートストラップ", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("members が0件のとき、email のローカル部を name とする admin member を作成しリンクする", async () => {
      const t = setup();
      const userId = await seedUser(t, { email: "founder@example.com" });

      await t.run((ctx) => linkAuthUserToMember(ctx, userId));

      expect(await findMemberByEmail(t, "founder@example.com")).toMatchObject({
        name: "founder",
        email: "founder@example.com",
        role: "admin",
        authUserId: userId,
      });
    });

    it("MCP_AGENT_EMAIL の member だけが存在する場合も、人間 member は実質0件としてブートストラップされる", async () => {
      const t = setup();
      vi.stubEnv("MCP_AGENT_EMAIL", "bot@example.com");
      await seedMember(t, { name: "Bot", email: "bot@example.com" });
      const userId = await seedUser(t, { email: "founder@example.com" });

      await t.run((ctx) => linkAuthUserToMember(ctx, userId));

      expect(await findMemberByEmail(t, "founder@example.com")).toMatchObject({
        role: "admin",
        authUserId: userId,
      });
    });

    it("エージェント member と人間 member が両方存在する場合、未招待 email は拒否される", async () => {
      const t = setup();
      vi.stubEnv("MCP_AGENT_EMAIL", "bot@example.com");
      await seedMember(t, { name: "Bot", email: "bot@example.com" });
      await seedMember(t, { name: "Alice", email: "alice@example.com" });
      const userId = await seedUser(t, { email: "newcomer@example.com" });

      await expect(
        t.run((ctx) => linkAuthUserToMember(ctx, userId)),
      ).rejects.toThrowError("このメールアドレスは招待されていません");
      expect(await countMembers(t)).toBe(2); // 新規 member が作られていない
    });
  });

  it.each([
    {
      name: "users doc に email が未設定",
      makeUserId: (t: T) => seedUser(t),
    },
    {
      name: "users doc が存在しない（削除済み）",
      makeUserId: async (t: T) => {
        const id = await seedUser(t, { email: "ghost@example.com" });
        await t.run((ctx) => ctx.db.delete(id));
        return id;
      },
    },
  ])("$name の場合は ConvexError で拒否する", async ({ makeUserId }) => {
    const t = setup();
    const userId = await makeUserId(t);

    await expect(
      t.run((ctx) => linkAuthUserToMember(ctx, userId)),
    ).rejects.toThrowError("認証ユーザーにメールアドレスが設定されていません");
  });

  it("email を正規化して照合する（大文字混じり・前後空白でも登録済み member にリンクされる）", async () => {
    const t = setup();
    const memberId = await seedMember(t, { email: "alice@example.com" });
    const userId = await seedUser(t, { email: " Alice@Example.COM " });

    await t.run((ctx) => linkAuthUserToMember(ctx, userId));

    expect(await getMember(t, memberId)).toMatchObject({ authUserId: userId });
  });
});
