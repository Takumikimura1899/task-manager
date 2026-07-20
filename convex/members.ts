import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { memberRole } from "./schema";
import { requireActor, requireAgentToken } from "./lib/auth";
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
    accessToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireActor(ctx, args.accessToken);

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
  args: { email: v.string(), accessToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireActor(ctx, args.accessToken);

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
  args: { accessToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireActor(ctx, args.accessToken);

    const members = await ctx.db.query("members").collect();
    // PII（email）を未認証クライアントへ露出しない。UI に必要な最小限のみ返す。
    return members.map((m) => ({ _id: m._id, name: m.name }));
  },
});

/**
 * MCP サーバー起動時にエージェント Member を解決・登録する（Issue #1 PR2）。
 * requireActor ではなく requireAgentToken（token 検証のみ）を使う: requireActor は
 * member の存在を前提とするため、member 未登録の初回起動では使えない
 * （circular）。member 事前存在を要求しないのはこの関数だけの特例。
 */
export const ensureAgent = mutation({
  args: {
    accessToken: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAgentToken(args.accessToken);

    const agentEmailRaw = process.env.MCP_AGENT_EMAIL;
    if (agentEmailRaw === undefined || agentEmailRaw === "") {
      throw new ConvexError(
        "MCP_AGENT_EMAIL が設定されていません（convex env set で設定してください）",
      );
    }
    const email = normalizeEmail(agentEmailRaw);

    const existing = await ctx.db
      .query("members")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (existing !== null) {
      if (args.name !== undefined) {
        await ctx.db.patch(existing._id, { name: args.name });
      }
      return existing._id;
    }

    const fallbackName = email.split("@")[0] ?? email;
    const memberId: Id<"members"> = await ctx.db.insert("members", {
      name: args.name ?? fallbackName,
      email,
      role: "member",
    });
    return memberId;
  },
});
