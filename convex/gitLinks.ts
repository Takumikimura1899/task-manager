import { ConvexError, v } from "convex/values";
import { type MutationCtx, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireActor } from "./lib/auth";
import { gitLinkType, prState } from "./schema";

/**
 * GitLink の Core API（基本設計書 §3 / §7）。
 * タスクと Git アーティファクト（branch/commit/pull_request）の関連を管理する。
 * Webhook からの繰り返し受信に備え、(task, repository, type, externalRef) で冪等化する。
 */

/**
 * GitLink の冪等 upsert。(task, repository, type, externalRef) で同定し、あれば更新する。
 * task を同定キーに含めるため、1つの Git アーティファクトを複数タスクへ
 * 独立にリンクできる（Issue #38: 1コミットが複数タスクを参照するケース）。
 * MCP（link mutation）と Webhook 自動処理の両方から再利用する共有ヘルパー。
 * 参照整合性の確認は呼び出し側の責務（Webhook 側は解決済みの id を渡す）。
 */
export async function upsertGitLink(
  ctx: MutationCtx,
  args: {
    task: Id<"tasks">;
    repository: Id<"repositories">;
    type: Doc<"gitLinks">["type"];
    externalRef: string;
    url: string;
    prState?: Doc<"gitLinks">["prState"];
  },
): Promise<Id<"gitLinks">> {
  const existing = await ctx.db
    .query("gitLinks")
    .withIndex("by_ref_and_task", (q) =>
      q
        .eq("repository", args.repository)
        .eq("type", args.type)
        .eq("externalRef", args.externalRef)
        .eq("task", args.task),
    )
    .unique();
  if (existing !== null) {
    await ctx.db.patch(existing._id, { url: args.url, prState: args.prState });
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
}

export const link = mutation({
  args: {
    task: v.id("tasks"),
    repository: v.id("repositories"),
    type: gitLinkType,
    externalRef: v.string(),
    url: v.string(),
    prState: v.optional(prState),
    accessToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireActor(ctx, args.accessToken);

    // 参照整合性（INVARIANT-3）
    if ((await ctx.db.get(args.task)) === null) {
      throw new ConvexError("指定されたタスクが存在しません");
    }
    if ((await ctx.db.get(args.repository)) === null) {
      throw new ConvexError("指定されたリポジトリが存在しません");
    }
    return await upsertGitLink(ctx, args);
  },
});

export const listByTask = query({
  args: { task: v.id("tasks"), accessToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireActor(ctx, args.accessToken);

    return await ctx.db
      .query("gitLinks")
      .withIndex("by_task", (q) => q.eq("task", args.task))
      .collect();
  },
});
