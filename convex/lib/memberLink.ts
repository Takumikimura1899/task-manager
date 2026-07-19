import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { normalizeEmail } from "./validators";

/**
 * Convex Auth の users を既存 member にリンクする招待制ゲート（Issue #1 PR1）。
 *
 * Password provider のサインアップ（convex/auth.ts の afterUserCreatedOrUpdated
 * コールバック）から呼ばれる、convex-test から直接検証できる純関数的ヘルパ。
 *
 * - メールアドレスが事前に members へ登録済み（招待済み） → その member にリンクする。
 * - 未登録 → ブートストラップ条件（後述）を満たす初回サインアップのみ admin として
 *   自己登録できる。それ以外は「招待されていません」で拒否し、signUp トランザクション
 *   ごとロールバックさせる（＝招待制の強制）。
 */
export async function linkAuthUserToMember(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<void> {
  const user = await ctx.db.get(userId);
  if (user === null || user.email === undefined) {
    throw new ConvexError("認証ユーザーにメールアドレスが設定されていません");
  }
  const email = normalizeEmail(user.email);

  const existing = await ctx.db
    .query("members")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique();

  if (existing !== null) {
    if (existing.authUserId === undefined) {
      await ctx.db.patch(existing._id, { authUserId: userId });
      return;
    }
    if (existing.authUserId === userId) {
      return; // 既にリンク済み（同一ユーザーの再サインインなど。冪等）
    }
    // 既に別の authUserId にリンク済みの member を横取りさせない（アカウント乗っ取り防止）。
    throw new ConvexError(
      "このメールアドレスは既に別のアカウントで登録されています。心当たりがない場合は管理者にご連絡ください。",
    );
  }

  // ブートストラップ判定: MCP エージェント用の bot アカウント（process.env.MCP_AGENT_EMAIL、
  // 未設定なら除外なし）を除いた members が 0 件のときに限り、最初のサインアップを
  // admin として自己登録できる（プロジェクト立ち上げ時に招待者が誰もいない問題の回避）。
  //
  // by_email の点読み（0 件ヒット）ではなく members のフル走査で数える。理由: Convex の
  // OCC は「読んだ範囲」が他トランザクションの書き込みと重なった場合にのみ競合と判定する。
  // 点読みだと「別 email の insert」はこの読み取り範囲と重ならないため、複数の signUp が
  // 並行に走った場合、双方が「0 件」を読んでブートストラップ条件を満たし、admin が複数
  // 作られてしまう。members テーブル全体を読み取り範囲に含めることで、並行 insert は
  // 必ず OCC 競合として検出・再試行され、ブートストラップは直列化されて高々1回になる。
  const agentEmail = process.env.MCP_AGENT_EMAIL
    ? normalizeEmail(process.env.MCP_AGENT_EMAIL)
    : null;
  const allMembers = await ctx.db.query("members").collect();
  const humanMemberCount = allMembers.filter(
    (m) => m.email !== agentEmail,
  ).length;

  if (humanMemberCount === 0) {
    const localPart = email.split("@")[0] ?? email;
    await ctx.db.insert("members", {
      name: localPart,
      email,
      role: "admin",
      authUserId: userId,
    });
    return;
  }

  throw new ConvexError(
    "このメールアドレスは招待されていません。管理者にメンバー登録を依頼してください。",
  );
}
