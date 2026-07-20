// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { seedMember, seedUser, type T } from "../../test/convexSupport";
import { generateInviteToken, sha256Hex } from "./crypto";
import { linkAuthUserToMember } from "./memberLink";

/**
 * linkAuthUserToMember の結合テスト（Issue #1 PR1・招待トークン方式は #1 追補）。
 *
 * Convex Auth の users → 既存 members への招待制リンクを convex-test の
 * インメモリ DB を実物として通して検証する（内部モック禁止・古典学派）。
 * 呼び出し元（convex/auth.ts の afterUserCreatedOrUpdated）は結線のみなので、
 * ここでは t.run から直接この関数を呼ぶ。
 */

const modules = import.meta.glob(["../**/*.ts", "!../**/*.test.ts"]);
const setup = () => convexTest(schema, modules);

const getMember = (t: T, id: Id<"members">) => t.run((ctx) => ctx.db.get(id));

const getUser = (t: T, id: Id<"users">) => t.run((ctx) => ctx.db.get(id));

const findMemberByEmail = (t: T, email: string) =>
  t.run((ctx) =>
    ctx.db
      .query("members")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique(),
  );

const countMembers = async (t: T) =>
  (await t.run((ctx) => ctx.db.query("members").collect())).length;

/**
 * 招待トークンの平文とハッシュのペアを生成する（members.create が発行する
 * ものと同じ形。DB には hash のみ、users.inviteCode には token を渡す）。
 */
const makeInvite = async () => {
  const token = generateInviteToken();
  const hash = await sha256Hex(token);
  return { token, hash };
};

describe("linkAuthUserToMember", () => {
  it("正しい招待コードで招待済み email の member に authUserId をリンクし、inviteTokenHash と users.inviteCode を両方除去する", async () => {
    const t = setup();
    const { token, hash } = await makeInvite();
    const memberId = await seedMember(t, {
      email: "alice@example.com",
      inviteTokenHash: hash,
    });
    const userId = await seedUser(t, {
      email: "alice@example.com",
      inviteCode: token,
    });

    await t.run((ctx) => linkAuthUserToMember(ctx, userId));

    expect(await getMember(t, memberId)).toMatchObject({ authUserId: userId });
    expect((await getMember(t, memberId))?.inviteTokenHash).toBeUndefined();
    expect((await getUser(t, userId))?.inviteCode).toBeUndefined();
  });

  it.each([
    { name: "inviteCode を提示しない", inviteCode: undefined },
    { name: "誤った inviteCode を提示する", inviteCode: "wrong-code" },
  ])(
    "招待コード不一致（$name）は拒否し、member をリンクしない（横取り対策）",
    async ({ inviteCode }) => {
      const t = setup();
      const { hash } = await makeInvite();
      const memberId = await seedMember(t, {
        email: "alice@example.com",
        inviteTokenHash: hash,
      });
      const userId = await seedUser(t, {
        email: "alice@example.com",
        inviteCode,
      });

      await expect(
        t.run((ctx) => linkAuthUserToMember(ctx, userId)),
      ).rejects.toThrowError("招待コードが確認できませんでした");

      const member = await getMember(t, memberId);
      expect(member?.authUserId).toBeUndefined(); // リンクされていない
      expect(member?.inviteTokenHash).toBe(hash); // 拒否時は member 側のハッシュも不変
    },
  );

  it("招待コードを見ないブートストラップ経路でも、提示された inviteCode は無条件クリアにより除去される（defense-in-depth）", async () => {
    // 拒否（throw）する経路は Convex のトランザクション（t.run も同様）が
    // 呼び出しごと丸ごとロールバックするため、事後に inviteCode の消去だけを
    // 単独では観測できない（signUp ごとロールバック・孤児レコードなしという
    // 本来の設計どおり）。無条件クリアの効果が実際に観測できるのは、
    // このようにトランザクションがコミットされる経路——招待コードを一切
    // 参照しないブートストラップ経路でも、無条件クリアの構造により
    // 消えていること。
    const t = setup();
    const userId = await seedUser(t, {
      email: "founder@example.com",
      inviteCode: "stray-code-unrelated-to-bootstrap",
    });

    await t.run((ctx) => linkAuthUserToMember(ctx, userId));

    expect((await getUser(t, userId))?.inviteCode).toBeUndefined();
  });

  it("inviteTokenHash 未設定の member（招待トークン未発行）は、正コードなしのサインアップでも拒否する（bot 相当の推測攻撃対策）", async () => {
    const t = setup();
    await seedMember(t, { email: "alice@example.com" }); // inviteTokenHash 未設定
    const userId = await seedUser(t, { email: "alice@example.com" }); // inviteCode 未提示

    await expect(
      t.run((ctx) => linkAuthUserToMember(ctx, userId)),
    ).rejects.toThrowError("招待コードが確認できませんでした");
  });

  it("同一 userId で再実行しても冪等（状態不変・エラーにならない）", async () => {
    const t = setup();
    const { token, hash } = await makeInvite();
    const memberId = await seedMember(t, {
      email: "alice@example.com",
      inviteTokenHash: hash,
    });
    const userId = await seedUser(t, {
      email: "alice@example.com",
      inviteCode: token,
    });
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
    const { token, hash } = await makeInvite();
    const memberId = await seedMember(t, {
      email: "alice@example.com",
      inviteTokenHash: hash,
    });
    const firstUserId = await seedUser(t, {
      email: "alice@example.com",
      inviteCode: token,
    });
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

    it("members が0件のとき、招待コードなしでも email のローカル部を name とする admin member を作成しリンクする", async () => {
      const t = setup();
      const userId = await seedUser(t, { email: "founder@example.com" }); // inviteCode 未提示

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
    const { token, hash } = await makeInvite();
    const memberId = await seedMember(t, {
      email: "alice@example.com",
      inviteTokenHash: hash,
    });
    const userId = await seedUser(t, {
      email: " Alice@Example.COM ",
      inviteCode: token,
    });

    await t.run((ctx) => linkAuthUserToMember(ctx, userId));

    expect(await getMember(t, memberId)).toMatchObject({ authUserId: userId });
  });
});
