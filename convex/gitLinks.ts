import { ConvexError, v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { projectMutation, projectQuery } from "./lib/auth";
import { projectOfTask } from "./lib/projectScope";
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

export const link = projectMutation(
  {
    task: v.id("tasks"),
    repository: v.id("repositories"),
    type: gitLinkType,
    externalRef: v.string(),
    url: v.string(),
    prState: v.optional(prState),
  },
  {
    permission: "task.*",
    project: (ctx, args) => projectOfTask(ctx, args.task),
  },
  async (ctx, args) => {
    // 参照整合性（INVARIANT-3）
    const task = await ctx.db.get(args.task);
    if (task === null) {
      throw new ConvexError("指定されたタスクが存在しません");
    }
    const repository = await ctx.db.get(args.repository);
    if (repository === null) {
      throw new ConvexError("指定されたリポジトリが存在しません");
    }
    // クロスプロジェクトリンクの防止（設計書 §4 の厳格化: 現行は未チェックだったため
    // PR② で追加）。
    if (repository.project !== task.project) {
      throw new ConvexError(
        "指定されたリポジトリは対象タスクのプロジェクトに属していません",
      );
    }
    return await upsertGitLink(ctx, args);
  },
);

export const listByTask = projectQuery(
  { task: v.id("tasks") },
  (ctx, args) => projectOfTask(ctx, args.task),
  async (ctx, args) => {
    return await ctx.db
      .query("gitLinks")
      .withIndex("by_task", (q) => q.eq("task", args.task))
      .collect();
  },
);
