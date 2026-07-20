import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { timingSafeTokenEqual } from "./crypto";
import { isValidEmail, normalizeEmail } from "./validators";

/**
 * 全公開関数の認証ゲート（Issue #1 PR2）。
 *
 * ゲートは2段構え:
 * - query → requireAuthed: 「誰であるか（認証済み or 正トークン）」だけを要求する。
 *   Member 未リンクでも閲覧は許可する（認証済みだが Member が消えた/未リンクの
 *   ユーザーを全画面クラッシュにせず、NoMembersNotice の案内へ落とすため。
 *   Issue #16 / #1。アクセスの完全な失効は Convex ダッシュボードで認証ユーザー
 *   自体を削除する）。
 * - mutation → requireActor: 書き込みの記録主体（actor）となる Member の解決まで
 *   要求する。未リンクは拒否。
 *
 * 呼び出し経路は2つ:
 * - MCP 経路（accessToken あり）: サーバ側の MCP_ACCESS_TOKEN と照合し、
 *   process.env.MCP_AGENT_EMAIL に紐づく member を actor として返す。
 * - ブラウザ経路（accessToken なし）: Convex Auth のセッション
 *   （getAuthUserId）から authUserId にリンクされた member を actor として返す。
 *
 * エージェントの email はクライアントから受け取らず、常に Convex 側の env
 * （MCP_AGENT_EMAIL）を単一の情報源とする。email を引数化すると、
 * 正しい accessToken さえあれば任意の email を騙って任意の member として
 * 振る舞える（本来のエージェント以外の member になりすませる）ため、
 * サーバ側でのみ解決できるようにしている。
 */

/**
 * 提示された accessToken をサーバ側の MCP_ACCESS_TOKEN と照合するだけの
 * トークン検証。member の解決は行わない（members.ensureAgent が初回起動時に
 * 呼ぶ。requireActor は member の存在を前提とするため、member 登録前の
 * 循環を避けるにはトークン検証だけを切り出す必要がある）。
 *
 * fail closed: MCP_ACCESS_TOKEN が未設定・空の場合は、たとえ accessToken も
 * 空であっても絶対に一致とみなさず拒否する。
 */
export async function requireAgentToken(
  accessToken: string | undefined,
): Promise<void> {
  const expected = process.env.MCP_ACCESS_TOKEN;
  if (expected === undefined || expected === "") {
    throw new ConvexError(
      "MCP_ACCESS_TOKEN が設定されていません（convex env set で設定してください）",
    );
  }
  if (accessToken === undefined || accessToken === "") {
    throw new ConvexError("accessToken が指定されていません");
  }
  if (!(await timingSafeTokenEqual(accessToken, expected))) {
    throw new ConvexError("accessToken が一致しません");
  }
}

/**
 * process.env.MCP_AGENT_EMAIL を検証込みで解決する（requireActor と
 * members.ensureAgent の共有ヘルパ。検証条件やメッセージの二重管理を防ぐ）。
 * 形式不正はここで即エラーにする: 黙って壊れた email の Member を作らせない
 * （CLAUDE.md「サイレント失敗の回避」）。
 */
export function requireAgentEmail(): string {
  const raw = process.env.MCP_AGENT_EMAIL;
  if (raw === undefined || raw === "") {
    throw new ConvexError(
      "MCP_AGENT_EMAIL が設定されていません（convex env set で設定してください）",
    );
  }
  const email = normalizeEmail(raw);
  if (!isValidEmail(email)) {
    throw new ConvexError(
      `MCP_AGENT_EMAIL の値がメールアドレスとして不正です: "${raw}"`,
    );
  }
  return email;
}

/**
 * authUserId にリンクされた member を解決する（requireActor と members.me の
 * 共有ヘルパ。「現在のユーザーは誰か」の解決を一箇所に集約する）。
 */
export async function findMemberByAuthUserId(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<Doc<"members"> | null> {
  return await ctx.db
    .query("members")
    .withIndex("by_authUserId", (q) => q.eq("authUserId", userId))
    .unique();
}

/**
 * query 用ゲート: 呼び出し元が「認証済みユーザー or 正トークンの MCP」で
 * あることだけを要求する（Member 未リンクでも閲覧可。冒頭コメント参照）。
 */
export async function requireAuthed(
  ctx: QueryCtx,
  accessToken?: string,
): Promise<void> {
  if (accessToken !== undefined) {
    await requireAgentToken(accessToken);
    return;
  }
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new ConvexError("認証が必要です");
  }
}

/**
 * mutation 用ゲート: 呼び出し元（actor）の member を解決する。書き込みは
 * 行わない（エージェント member の初回登録は members.ensureAgent の責務）。
 */
export async function requireActor(
  ctx: QueryCtx,
  accessToken?: string,
): Promise<Doc<"members">> {
  if (accessToken !== undefined) {
    await requireAgentToken(accessToken);

    const agentEmail = requireAgentEmail();
    const member = await ctx.db
      .query("members")
      .withIndex("by_email", (q) => q.eq("email", agentEmail))
      .unique();
    if (member === null) {
      throw new ConvexError(
        "エージェント Member が未登録です。MCP サーバを再起動して ensureAgent を実行してください",
      );
    }
    return member;
  }

  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new ConvexError("認証が必要です");
  }
  const member = await findMemberByAuthUserId(ctx, userId);
  if (member === null) {
    throw new ConvexError("メンバー登録がありません");
  }
  return member;
}
