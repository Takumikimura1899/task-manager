import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { memberRole } from "./schema";
import { isValidEmail, normalizeEmail } from "./lib/validators";

/**
 * Member の Core API（基本設計書 §3）。
 * 人間・AIエージェントいずれも Member として表現する。
 * email の一意性（INVARIANT）は正規化後の値を by_email で確認し、
 * Convex のトランザクション（OCC）により保証する。
 */

export const create = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    role: memberRole,
  },
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    if (!isValidEmail(email)) {
      throw new ConvexError(`メールアドレスが不正です: "${args.email}"`);
    }

    const existing = await ctx.db
      .query("members")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (existing !== null) {
      throw new ConvexError(`メールアドレス "${email}" は既に登録されています`);
    }

    return await ctx.db.insert("members", {
      name: args.name,
      email, // 正規化済みの値を保存する
      role: args.role,
    });
  },
});

export const getByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("members")
      .withIndex("by_email", (q) => q.eq("email", normalizeEmail(args.email)))
      .unique();
  },
});

/**
 * サインイン中の自分自身の member 情報を返す。
 *
 * リンクキーには users._id（authUserId）を使う。Convex Auth の
 * UserIdentity.tokenIdentifier / subject は `userId|sessionId` 形式で
 * セッションごとに値が変わるため一意な永続キーにならない（guidelines.md の
 * 「tokenIdentifier を優先せよ」は外部 IdP を JWT 発行者として使う一般的な
 * ケース向けの助言で、Convex Auth 自身が発行者のこの構成には当てはまらない）。
 * users._id はサインアウト・再サインインをまたいで不変な唯一の安定キーであり、
 * authUserId のリンクにはこちらを用いる。
 *
 * 本人自身の情報照会なので email も返す（list と異なり PII 制限は不要）。
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;

    const member = await ctx.db
      .query("members")
      .withIndex("by_authUserId", (q) => q.eq("authUserId", userId))
      .unique();
    if (member === null) return null;

    return {
      _id: member._id,
      name: member.name,
      role: member.role,
      email: member.email,
    };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const members = await ctx.db.query("members").collect();
    // PII（email）を未認証クライアントへ露出しない。UI に必要な最小限のみ返す。
    // 認証導入（Phase2）までの暫定ハードニング。本人性の担保は認証側で行う。
    return members.map((m) => ({ _id: m._id, name: m.name }));
  },
});
