import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { timingSafeTokenEqual } from "./crypto";
import { normalizeEmail } from "./validators";

/**
 * 全公開関数の認証ゲート（Issue #1 PR2）。
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
 * 呼び出し元（actor）の member を解決する。書き込みは行わない
 * （query からも呼ばれるため、member の自動作成はできない。エージェント
 * member の初回登録は members.ensureAgent の責務）。
 */
export async function requireActor(
  ctx: QueryCtx,
  accessToken?: string,
): Promise<Doc<"members">> {
  if (accessToken !== undefined) {
    await requireAgentToken(accessToken);

    const agentEmailRaw = process.env.MCP_AGENT_EMAIL;
    if (agentEmailRaw === undefined || agentEmailRaw === "") {
      throw new ConvexError(
        "MCP_AGENT_EMAIL が設定されていません（convex env set で設定してください）",
      );
    }
    const agentEmail = normalizeEmail(agentEmailRaw);
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
  const member = await ctx.db
    .query("members")
    .withIndex("by_authUserId", (q) => q.eq("authUserId", userId))
    .unique();
  if (member === null) {
    throw new ConvexError("メンバー登録がありません");
  }
  return member;
}
