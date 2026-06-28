import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { gitLinkType, prState } from "./schema";

/**
 * GitLink の Core API（基本設計書 §3 / §7）。
 * タスクと Git アーティファクト（branch/commit/pull_request）の関連を管理する。
 * Webhook からの繰り返し受信に備え、(repository, type, externalRef) で冪等化する。
 */

export const link = mutation({
  args: {
    task: v.id("tasks"),
    repository: v.id("repositories"),
    type: gitLinkType,
    externalRef: v.string(),
    url: v.string(),
    prState: v.optional(prState),
  },
  handler: async (ctx, args) => {
    // 参照整合性（INVARIANT-3）
    if ((await ctx.db.get(args.task)) === null) {
      throw new ConvexError("指定されたタスクが存在しません");
    }
    if ((await ctx.db.get(args.repository)) === null) {
      throw new ConvexError("指定されたリポジトリが存在しません");
    }

    // 冪等化: 同一 (repository, type, externalRef) が既にあれば更新する。
    const existing = await ctx.db
      .query("gitLinks")
      .withIndex("by_ref", (q) =>
        q
          .eq("repository", args.repository)
          .eq("type", args.type)
          .eq("externalRef", args.externalRef),
      )
      .unique();
    if (existing !== null) {
      await ctx.db.patch(existing._id, {
        url: args.url,
        prState: args.prState,
      });
      return existing._id;
    }

    return await ctx.db.insert("gitLinks", {
      task: args.task,
      repository: args.repository,
      type: args.type,
      externalRef: args.externalRef,
      url: args.url,
      prState: args.prState,
    });
  },
});

export const listByTask = query({
  args: { task: v.id("tasks") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("gitLinks")
      .withIndex("by_task", (q) => q.eq("task", args.task))
      .collect();
  },
});
