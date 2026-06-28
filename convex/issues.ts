import { ConvexError, v } from "convex/values";
import { type QueryCtx, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { deriveIssueStatus } from "./lib/issueStatus";
import { taskPriority } from "./schema";
import { insertTask } from "./tasks";

/**
 * Issue の Core API（基本設計書 §3 / §5.1 / ADR-9・ADR-10）。
 *
 * - INVARIANT-1 採番一意性: project.nextIssueNumber を mutation 内で atomic に採番。
 * - INVARIANT-5 最低基数: Issue 作成は最初の Task を同一トランザクションで伴う。
 * - Issue.status は保持せず、子 Task 群から派生（deriveIssueStatus）。
 */

async function getIssueOrThrow(
  ctx: QueryCtx,
  id: Id<"issues">,
): Promise<Doc<"issues">> {
  const issue = await ctx.db.get(id);
  if (issue === null) {
    throw new ConvexError("Issue が見つかりません");
  }
  return issue;
}

/** Issue 配下の Task を取得する（派生ステータス算出・最低基数チェックに利用）。 */
async function tasksOfIssue(
  ctx: QueryCtx,
  issue: Id<"issues">,
): Promise<Doc<"tasks">[]> {
  return await ctx.db
    .query("tasks")
    .withIndex("by_issue", (q) => q.eq("issue", issue))
    .collect();
}

// --- Mutations --------------------------------------------------------------

/**
 * Issue を作成する。INVARIANT-5 を満たすため、最初の Task を必ず同時に作成する。
 */
export const create = mutation({
  args: {
    project: v.id("projects"),
    title: v.string(),
    description: v.optional(v.string()),
    createdBy: v.id("members"),
    firstTask: v.object({
      title: v.string(),
      description: v.optional(v.string()),
      priority: v.optional(taskPriority),
      assignee: v.optional(v.id("members")),
    }),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.project);
    if (project === null) {
      throw new ConvexError("指定されたプロジェクトが存在しません");
    }
    if ((await ctx.db.get(args.createdBy)) === null) {
      throw new ConvexError("指定されたメンバーが存在しません");
    }

    // 採番（INVARIANT-1）: Issue 連番を採番してカウンタを進める。
    const number = project.nextIssueNumber;
    await ctx.db.patch(project._id, { nextIssueNumber: number + 1 });

    const issue = await ctx.db.insert("issues", {
      project: project._id,
      number,
      title: args.title,
      description: args.description,
      createdBy: args.createdBy,
      revision: 0,
      updatedAt: Date.now(),
    });

    // INVARIANT-5: Issue は ≥1 Task を持つ。最初の Task を必ず作成する。
    const task = await insertTask(ctx, {
      issue,
      project: project._id,
      title: args.firstTask.title,
      description: args.firstTask.description,
      priority: args.firstTask.priority,
      assignee: args.firstTask.assignee,
      createdBy: args.createdBy,
    });

    return { issue, task };
  },
});

/**
 * Issue 削除（破壊的・§6 で Human-in-the-Loop 承認必須）。
 * 配下 Task と、その GitLink も併せて削除する（参照整合性の維持）。
 */
export const remove = mutation({
  args: { id: v.id("issues"), expectedRevision: v.number() },
  handler: async (ctx, args) => {
    const issue = await getIssueOrThrow(ctx, args.id);
    if (issue.revision !== args.expectedRevision) {
      throw new ConvexError(
        "競合が発生しました。他の更新があったため最新を取得してください。",
      );
    }

    for (const task of await tasksOfIssue(ctx, issue._id)) {
      const links = await ctx.db
        .query("gitLinks")
        .withIndex("by_task", (q) => q.eq("task", task._id))
        .collect();
      for (const link of links) {
        await ctx.db.delete(link._id);
      }
      await ctx.db.delete(task._id);
    }
    await ctx.db.delete(issue._id);
  },
});

// --- Queries ----------------------------------------------------------------

/** プロジェクトの Issue 一覧。各 Issue に派生ステータスと Task 数を付与する。 */
export const list = query({
  args: { project: v.id("projects") },
  handler: async (ctx, args) => {
    const issues = await ctx.db
      .query("issues")
      .withIndex("by_project", (q) => q.eq("project", args.project))
      .collect();

    return await Promise.all(
      issues.map(async (issue) => {
        const tasks = await tasksOfIssue(ctx, issue._id);
        return {
          ...issue,
          status: deriveIssueStatus(tasks.map((t) => t.status)),
          taskCount: tasks.length,
          doneCount: tasks.filter((t) => t.status === "done").length,
        };
      }),
    );
  },
});

/** {key}#{number} 形式の参照から Issue を解決し、派生ステータスと配下 Task を返す。 */
export const getByRef = query({
  args: { projectKey: v.string(), number: v.number() },
  handler: async (ctx, args) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_key", (q) => q.eq("key", args.projectKey))
      .unique();
    if (project === null) return null;

    const issue = await ctx.db
      .query("issues")
      .withIndex("by_project_and_number", (q) =>
        q.eq("project", project._id).eq("number", args.number),
      )
      .unique();
    if (issue === null) return null;

    const tasks = await tasksOfIssue(ctx, issue._id);
    return {
      ...issue,
      status: deriveIssueStatus(tasks.map((t) => t.status)),
      tasks,
    };
  },
});
