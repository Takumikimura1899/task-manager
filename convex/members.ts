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

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("members").collect();
  },
});
