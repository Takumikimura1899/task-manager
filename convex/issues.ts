import { ConvexError, v } from "convex/values";
import { type QueryCtx, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { deriveIssueStatus } from "./lib/issueStatus";
import { resolveMemberName, resolveMemberNames } from "./lib/members";
import { findProjectByKey } from "./lib/projects";
import { assertRevision, nextMeta } from "./lib/revision";
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
    priority: v.optional(taskPriority),
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
    // createdBy の実在確認（INVARIANT-3）は insertTask に集約されている。
    // 検証に失敗した場合は mutation 全体がロールバックされるため、
    // ここで先行チェックしなくても Issue が残ることはない。

    // 採番（INVARIANT-1）: Issue 連番を採番してカウンタを進める。
    const number = project.nextIssueNumber;
    await ctx.db.patch(project._id, { nextIssueNumber: number + 1 });

    const issue = await ctx.db.insert("issues", {
      project: project._id,
      number,
      title: args.title,
      description: args.description,
      createdBy: args.createdBy,
      priority: args.priority,
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
 * タイトル・説明の更新（revision 楽観ロック・INVARIANT-2）。
 * status は子 Task 群からの派生（§5.1）のためここでは扱わない。
 */
export const update = mutation({
  args: {
    id: v.id("issues"),
    expectedRevision: v.number(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    priority: v.optional(taskPriority),
  },
  handler: async (ctx, args) => {
    const issue = await getIssueOrThrow(ctx, args.id);
    assertRevision(issue, args.expectedRevision);

    const patch: Partial<Doc<"issues">> = nextMeta(issue);
    if (args.title !== undefined) patch.title = args.title;
    if (args.description !== undefined) patch.description = args.description;
    if (args.priority !== undefined) patch.priority = args.priority;

    await ctx.db.patch(issue._id, patch);
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
    assertRevision(issue, args.expectedRevision);

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

    // N+1 回避: Issue ごとに tasksOfIssue を発行せず、project 配下の Task を
    // by_project で一括取得してメモリ上で Issue ごとにグルーピングする。
    const projectTasks = await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("project", args.project))
      .collect();
    const tasksByIssue = new Map<Id<"issues">, Doc<"tasks">[]>();
    for (const task of projectTasks) {
      const group = tasksByIssue.get(task.issue);
      if (group === undefined) {
        tasksByIssue.set(task.issue, [task]);
      } else {
        group.push(task);
      }
    }

    return issues.map((issue) => {
      const tasks = tasksByIssue.get(issue._id) ?? [];
      // 進捗は canceled を除いた「実行対象」で集計（派生ステータスと同基準・§5.1）。
      const active = tasks.filter((t) => t.status !== "canceled");
      return {
        ...issue,
        priority: issue.priority ?? "none",
        status: deriveIssueStatus(tasks.map((t) => t.status)),
        taskCount: active.length,
        doneCount: active.filter((t) => t.status === "done").length,
        estimateTotal: active.reduce((sum, t) => sum + (t.estimate ?? 0), 0),
        actualTotal: active.reduce((sum, t) => sum + (t.actual ?? 0), 0),
      };
    });
  },
});

/**
 * 進行中（in_progress）の Issue だけを、表示に必要な最小フィールドで返す。
 * ActiveIssueStrip（ボード画面上部の帯）専用の軽量版。フル指標（工数集計等）が
 * 必要な場合は list を使うこと。
 *
 * D&D のホットパス（Task 書き込みごとにサーバーで再計算される購読）上にあるため、
 * list と異なり estimateTotal/actualTotal の reduce や Issue ドキュメント全体の
 * スプレッドは行わず、in_progress の Issue のみを最小フィールドで返す。
 */
export const listInProgress = query({
  args: { project: v.id("projects") },
  handler: async (ctx, args) => {
    const issues = await ctx.db
      .query("issues")
      .withIndex("by_project", (q) => q.eq("project", args.project))
      .collect();

    // N+1 回避: list と同様、project 配下の Task を一括取得してメモリ上で
    // Issue ごとにグルーピングする。
    const projectTasks = await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("project", args.project))
      .collect();
    const tasksByIssue = new Map<Id<"issues">, Doc<"tasks">[]>();
    for (const task of projectTasks) {
      const group = tasksByIssue.get(task.issue);
      if (group === undefined) {
        tasksByIssue.set(task.issue, [task]);
      } else {
        group.push(task);
      }
    }

    const result: {
      _id: Id<"issues">;
      number: number;
      title: string;
      taskCount: number;
      doneCount: number;
    }[] = [];
    for (const issue of issues) {
      const tasks = tasksByIssue.get(issue._id) ?? [];
      if (deriveIssueStatus(tasks.map((t) => t.status)) !== "in_progress") {
        continue;
      }
      // 進捗は canceled を除いた「実行対象」で集計（派生ステータスと同基準・§5.1）。
      const active = tasks.filter((t) => t.status !== "canceled");
      result.push({
        _id: issue._id,
        number: issue.number,
        title: issue.title,
        taskCount: active.length,
        doneCount: active.filter((t) => t.status === "done").length,
      });
    }
    return result;
  },
});

/**
 * {key}#{number} 参照から project と issue を引く共通前段。
 * どちらかが見つからなければ null（エラーにするかは呼び出し元の契約に委ねる）。
 * 参照解決の仕様変更（除外条件・インデックス変更等）はここに集約する。
 */
async function findIssueByRef(
  ctx: QueryCtx,
  projectKey: string,
  number: number,
): Promise<{ project: Doc<"projects">; issue: Doc<"issues"> } | null> {
  const project = await findProjectByKey(ctx, projectKey);
  if (project === null) return null;

  const issue = await ctx.db
    .query("issues")
    .withIndex("by_project_and_number", (q) =>
      q.eq("project", project._id).eq("number", number),
    )
    .unique();
  if (issue === null) return null;
  return { project, issue };
}

/**
 * {key}#{number} 形式の参照から Issue の _id だけを解決する軽量版。
 * getByRef は配下 Task と担当者名まで join するため、_id しか要らない
 * 更新系（MCP の update_issue 等）はこちらを使う。
 */
export const getIdByRef = query({
  args: { projectKey: v.string(), number: v.number() },
  handler: async (ctx, args) => {
    const found = await findIssueByRef(ctx, args.projectKey, args.number);
    return found === null ? null : found.issue._id;
  },
});

/**
 * {key}#{number} 形式の参照から Issue を解決し、派生ステータスと配下 Task を返す。
 * 詳細画面の表示用に作成者名と各 Task の担当者名を付与する
 * （member の PII は返さず name のみ）。
 */
export const getByRef = query({
  args: { projectKey: v.string(), number: v.number() },
  handler: async (ctx, args) => {
    const found = await findIssueByRef(ctx, args.projectKey, args.number);
    if (found === null) return null;
    const { project, issue } = found;

    const tasks = await tasksOfIssue(ctx, issue._id);

    // 担当者名は参照された分だけ解決する（members 全件 .collect() は避ける）。
    const memberName = await resolveMemberNames(
      ctx,
      tasks.map((t) => t.assignee),
    );

    return {
      ...issue,
      projectKey: project.key,
      priority: issue.priority ?? "none",
      status: deriveIssueStatus(tasks.map((t) => t.status)),
      createdByName: await resolveMemberName(ctx, issue.createdBy),
      tasks: tasks.map((t) => ({
        ...t,
        assigneeName:
          t.assignee === undefined
            ? null
            : (memberName.get(t.assignee) ?? null),
      })),
    };
  },
});
