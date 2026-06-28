import { ConvexError, v } from "convex/values";
import { type QueryCtx, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { taskPriority, taskStatus } from "./schema";
import { TASK_STATUSES, canTransition } from "./lib/taskStatus";
import { rankBetween } from "./lib/rank";

/**
 * Task の Core API（基本設計書 §3 / §4 / §5）。
 *
 * 不変条件の強制点をこの層に集約する（UI・MCP・Webhook で共有）:
 * - INVARIANT-1 採番一意性: project.nextTaskNumber を mutation 内で atomic に
 *   インクリメント（Convex の OCC が並行採番の重複を検出・再試行）
 * - INVARIANT-2 並行更新検出: revision（楽観ロック）を更新条件として比較
 * - INVARIANT-3 参照整合性: project/createdBy/assignee の実在を確認
 * - INVARIANT-4 状態の妥当性: 状態機械 canTransition で遷移を検証
 */

// --- 内部ヘルパー -----------------------------------------------------------

async function getTaskOrThrow(
  ctx: QueryCtx,
  id: Id<"tasks">,
): Promise<Doc<"tasks">> {
  const task = await ctx.db.get(id);
  if (task === null) {
    throw new ConvexError("タスクが見つかりません");
  }
  return task;
}

/** 楽観ロック（INVARIANT-2）。revision 不一致は競合として明示的に失敗させる。 */
function assertRevision(task: Doc<"tasks">, expectedRevision: number): void {
  if (task.revision !== expectedRevision) {
    throw new ConvexError(
      "競合が発生しました。他の更新があったため最新を取得してください。",
    );
  }
}

async function assertMemberExists(
  ctx: QueryCtx,
  memberId: Id<"members">,
): Promise<void> {
  if ((await ctx.db.get(memberId)) === null) {
    throw new ConvexError("指定されたメンバーが存在しません");
  }
}

/** 指定列（project × status）の末尾 rank を返す（空なら null）。Webhook 自動遷移でも再利用する。 */
export async function lastRankInColumn(
  ctx: QueryCtx,
  project: Id<"projects">,
  status: Doc<"tasks">["status"],
): Promise<string | null> {
  const last = await ctx.db
    .query("tasks")
    .withIndex("by_project_and_status", (q) =>
      q.eq("project", project).eq("status", status),
    )
    .order("desc")
    .first();
  return last === null ? null : last.rank;
}

/** 更新の共通後処理: revision をインクリメントし updatedAt を更新する。 */
function nextMeta(task: Doc<"tasks">): { revision: number; updatedAt: number } {
  return { revision: task.revision + 1, updatedAt: Date.now() };
}

// --- Mutations --------------------------------------------------------------

export const create = mutation({
  args: {
    project: v.id("projects"),
    title: v.string(),
    description: v.optional(v.string()),
    priority: v.optional(taskPriority),
    assignee: v.optional(v.id("members")),
    createdBy: v.id("members"),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.project);
    if (project === null) {
      throw new ConvexError("指定されたプロジェクトが存在しません");
    }
    await assertMemberExists(ctx, args.createdBy);
    if (args.assignee !== undefined) {
      await assertMemberExists(ctx, args.assignee);
    }

    // 採番（INVARIANT-1）: 現在値を採番し、カウンタを進める。
    const number = project.nextTaskNumber;
    await ctx.db.patch(project._id, { nextTaskNumber: number + 1 });

    // 新規タスクは backlog 列の末尾に置く。
    const tail = await lastRankInColumn(ctx, args.project, "backlog");
    const rank = rankBetween(tail, null);

    return await ctx.db.insert("tasks", {
      project: args.project,
      number,
      title: args.title,
      description: args.description,
      status: "backlog",
      priority: args.priority ?? "none",
      assignee: args.assignee,
      rank,
      createdBy: args.createdBy,
      revision: 0,
      updatedAt: Date.now(),
    });
  },
});

/** タイトル・説明・優先度の更新（status/assignee/rank は専用 mutation を使う）。 */
export const updateFields = mutation({
  args: {
    id: v.id("tasks"),
    expectedRevision: v.number(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    priority: v.optional(taskPriority),
  },
  handler: async (ctx, args) => {
    const task = await getTaskOrThrow(ctx, args.id);
    assertRevision(task, args.expectedRevision);

    const patch: Partial<Doc<"tasks">> = nextMeta(task);
    if (args.title !== undefined) patch.title = args.title;
    if (args.description !== undefined) patch.description = args.description;
    if (args.priority !== undefined) patch.priority = args.priority;

    await ctx.db.patch(task._id, patch);
  },
});

/**
 * ステータス遷移（§5 状態機械）。遷移先列の末尾に再配置する。
 * 破壊的遷移（done/canceled）の Human-in-the-Loop 承認はホスト（MCP/UI）の責務で、
 * ここでは遷移の妥当性のみを強制する。
 */
export const transitionStatus = mutation({
  args: {
    id: v.id("tasks"),
    to: taskStatus,
    expectedRevision: v.number(),
  },
  handler: async (ctx, args) => {
    const task = await getTaskOrThrow(ctx, args.id);
    assertRevision(task, args.expectedRevision);

    if (!canTransition(task.status, args.to)) {
      throw new ConvexError(
        `状態遷移できません: ${task.status} → ${args.to}`,
      );
    }

    // 遷移先の列の末尾に置く（列ごとに rank 空間は独立）。
    const tail = await lastRankInColumn(ctx, task.project, args.to);
    await ctx.db.patch(task._id, {
      status: args.to,
      rank: rankBetween(tail, null),
      ...nextMeta(task),
    });
  },
});

/** 担当者の割り当て・解除（null で解除）。 */
export const assign = mutation({
  args: {
    id: v.id("tasks"),
    assignee: v.union(v.id("members"), v.null()),
    expectedRevision: v.number(),
  },
  handler: async (ctx, args) => {
    const task = await getTaskOrThrow(ctx, args.id);
    assertRevision(task, args.expectedRevision);
    if (args.assignee !== null) {
      await assertMemberExists(ctx, args.assignee);
    }

    await ctx.db.patch(task._id, {
      assignee: args.assignee ?? undefined,
      ...nextMeta(task),
    });
  },
});

/**
 * 同一列内の D&D 並べ替え。before/after は移動先の隣接タスクの rank
 * （先頭は before=null、末尾は after=null）。隣接の rank を書き換えずに
 * 間へ挿入する（基本設計書 §3 OrderedRank）。
 */
export const move = mutation({
  args: {
    id: v.id("tasks"),
    before: v.union(v.string(), v.null()),
    after: v.union(v.string(), v.null()),
    expectedRevision: v.number(),
  },
  handler: async (ctx, args) => {
    const task = await getTaskOrThrow(ctx, args.id);
    assertRevision(task, args.expectedRevision);

    await ctx.db.patch(task._id, {
      rank: rankBetween(args.before, args.after),
      ...nextMeta(task),
    });
  },
});

/**
 * タスク削除（破壊的操作・§6 で Human-in-the-Loop 承認必須）。
 * 参照整合性（INVARIANT-3）維持のため、関連する GitLink も併せて削除する。
 */
export const deleteTask = mutation({
  args: { id: v.id("tasks"), expectedRevision: v.number() },
  handler: async (ctx, args) => {
    const task = await getTaskOrThrow(ctx, args.id);
    assertRevision(task, args.expectedRevision);

    const links = await ctx.db
      .query("gitLinks")
      .withIndex("by_task", (q) => q.eq("task", task._id))
      .collect();
    for (const link of links) {
      await ctx.db.delete(link._id);
    }
    await ctx.db.delete(task._id);
  },
});

// --- Queries ----------------------------------------------------------------

export const listByProject = query({
  args: { project: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("project", args.project))
      .collect();
  },
});

/** カンバン表示用: 固定6状態の列順で、各列を rank 昇順に整列して返す。 */
export const board = query({
  args: { project: v.id("projects") },
  handler: async (ctx, args) => {
    const columns = await Promise.all(
      TASK_STATUSES.map(async (status) => ({
        status,
        tasks: await ctx.db
          .query("tasks")
          .withIndex("by_project_and_status", (q) =>
            q.eq("project", args.project).eq("status", status),
          )
          .collect(), // index 末尾フィールドが rank のため既に昇順
      })),
    );
    return columns;
  },
});

/** {key}-{number} 形式の参照からタスクを解決する。 */
export const getByRef = query({
  args: { projectKey: v.string(), number: v.number() },
  handler: async (ctx, args) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_key", (q) => q.eq("key", args.projectKey))
      .unique();
    if (project === null) return null;

    return await ctx.db
      .query("tasks")
      .withIndex("by_project_and_number", (q) =>
        q.eq("project", project._id).eq("number", args.number),
      )
      .unique();
  },
});
