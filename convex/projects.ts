import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { isValidProjectKey } from "./lib/validators";

/**
 * Project の Core API（基本設計書 §3 / §4 設計原則1）。
 * key の一意性（INVARIANT）は by_key インデックスでの存在確認＋
 * Convex のトランザクション（OCC）により保証する。
 */

export const create = mutation({
  args: {
    key: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!isValidProjectKey(args.key)) {
      throw new ConvexError(
        `プロジェクトキーが不正です: "${args.key}"（大文字英字2〜10文字）`,
      );
    }

    const existing = await ctx.db
      .query("projects")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (existing !== null) {
      throw new ConvexError(
        `プロジェクトキー "${args.key}" は既に使用されています`,
      );
    }

    return await ctx.db.insert("projects", {
      key: args.key,
      name: args.name,
      description: args.description,
      // 採番は 1 から開始（INVARIANT-1）。Task / Issue で別カウンタ。
      nextTaskNumber: 1,
      nextIssueNumber: 1,
    });
  },
});

export const getByKey = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projects")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("projects").collect();
  },
});
