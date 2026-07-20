import { ConvexError, v } from "convex/values";
import {
  type MutationCtx,
  type QueryCtx,
  mutation,
  query,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { taskPriority, taskStatus } from "./schema";
import { requireActor } from "./lib/auth";
import { resolveMemberName, resolveMemberNames } from "./lib/members";
import { findProjectByKey } from "./lib/projects";
import { assertRevision, nextMeta } from "./lib/revision";
import { TASK_STATUSES, canTransition } from "./lib/taskStatus";
import { rankBetween } from "./lib/rank";
import { assertHours } from "./lib/validators";

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

/**
 * Task を採番して backlog 列の末尾に挿入する内部ヘルパー。
 * 公開 create と issues.create（最初の Task 生成）から共有し、
 * 採番（INVARIANT-1）と参照検証（INVARIANT-3）を一箇所に集約する。
 */
export async function insertTask(
  ctx: MutationCtx,
  args: {
    issue: Id<"issues">;
    project: Id<"projects">;
    title: string;
    description?: string;
    priority?: Doc<"tasks">["priority"];
    assignee?: Id<"members">;
    createdBy: Id<"members">;
  },
): Promise<Id<"tasks">> {
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

  // 新規 Task は backlog 列の末尾に置く。
  const tail = await lastRankInColumn(ctx, args.project, "backlog");

  return await ctx.db.insert("tasks", {
    issue: args.issue,
    project: args.project,
    number,
    title: args.title,
    description: args.description,
    status: "backlog",
    priority: args.priority ?? "none",
    assignee: args.assignee,
    rank: rankBetween(tail, null),
    createdBy: args.createdBy,
    revision: 0,
    updatedAt: Date.now(),
  });
}

// --- Mutations --------------------------------------------------------------

export const create = mutation({
  args: {
    issue: v.id("issues"),
    title: v.string(),
    description: v.optional(v.string()),
    priority: v.optional(taskPriority),
    assignee: v.optional(v.id("members")),
    accessToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.accessToken);

    // Task は必ず Issue に従属する（INVARIANT-5）。project は Issue から解決する。
    const issue = await ctx.db.get(args.issue);
    if (issue === null) {
      throw new ConvexError("指定された Issue が存在しません");
    }

    return await insertTask(ctx, {
      issue: issue._id,
      project: issue.project,
      title: args.title,
      description: args.description,
      priority: args.priority,
      assignee: args.assignee,
      createdBy: actor._id,
    });
  },
});

/** タイトル・説明・優先度・見積/実績工数の更新（status/assignee/rank は専用 mutation を使う）。 */
export const updateFields = mutation({
  args: {
    id: v.id("tasks"),
    expectedRevision: v.number(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    priority: v.optional(taskPriority),
    // null はクリア（見積/実績なし状態へ戻す）を表す。
    estimate: v.optional(v.union(v.number(), v.null())),
    actual: v.optional(v.union(v.number(), v.null())),
    accessToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireActor(ctx, args.accessToken);

    const task = await getTaskOrThrow(ctx, args.id);
    assertRevision(task, args.expectedRevision);

    assertHours("見積工数", args.estimate);
    assertHours("実績工数", args.actual);

    const patch: Partial<Doc<"tasks">> = nextMeta(task);
    if (args.title !== undefined) patch.title = args.title;
    if (args.description !== undefined) patch.description = args.description;
    if (args.priority !== undefined) patch.priority = args.priority;
    if (args.estimate !== undefined)
      patch.estimate = args.estimate ?? undefined;
    if (args.actual !== undefined) patch.actual = args.actual ?? undefined;

    await ctx.db.patch(task._id, patch);
  },
});

/**
 * ステータス遷移（§5 状態機械）。遷移先列へ再配置する。
 * - before/after を指定すると、その隣接 rank の間へ挿入する（列をまたぐ D&D の
 *   ドロップ位置を尊重する）。同一列並べ替え（move）と同じ OrderedRank 方式。
 * - 未指定なら遷移先列の末尾に置く（MCP/自動化など位置を持たない呼び出し向け）。
 *
 * 破壊的遷移（done/canceled）の Human-in-the-Loop 承認はホスト（MCP/UI）の責務で、
 * ここでは遷移の妥当性のみを強制する。
 */
export const transitionStatus = mutation({
  args: {
    id: v.id("tasks"),
    to: taskStatus,
    expectedRevision: v.number(),
    before: v.optional(v.union(v.string(), v.null())),
    after: v.optional(v.union(v.string(), v.null())),
    accessToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireActor(ctx, args.accessToken);

    const task = await getTaskOrThrow(ctx, args.id);
    assertRevision(task, args.expectedRevision);

    if (!canTransition(task.status, args.to)) {
      throw new ConvexError(`状態遷移できません: ${task.status} → ${args.to}`);
    }

    // 位置指定（before/after のいずれか）があればその間へ、なければ列の末尾へ。
    // 列ごとに rank 空間は独立する。
    const positioned = args.before !== undefined || args.after !== undefined;
    const rank = positioned
      ? rankBetween(args.before ?? null, args.after ?? null)
      : rankBetween(await lastRankInColumn(ctx, task.project, args.to), null);

    await ctx.db.patch(task._id, {
      status: args.to,
      rank,
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
    accessToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireActor(ctx, args.accessToken);

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
    accessToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireActor(ctx, args.accessToken);

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
  args: {
    id: v.id("tasks"),
    expectedRevision: v.number(),
    accessToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireActor(ctx, args.accessToken);

    const task = await getTaskOrThrow(ctx, args.id);
    assertRevision(task, args.expectedRevision);

    // INVARIANT-5: Issue は常に ≥1 Task を持つ。最後の Task の削除は拒否し、
    // Issue ごと削除する操作（issues.remove）へ誘導する。
    const siblings = await ctx.db
      .query("tasks")
      .withIndex("by_issue", (q) => q.eq("issue", task.issue))
      .collect();
    if (siblings.length <= 1) {
      throw new ConvexError(
        "Issue の最後の Task は削除できません。Issue ごと削除してください。",
      );
    }

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
  args: { project: v.id("projects"), accessToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireActor(ctx, args.accessToken);

    return await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("project", args.project))
      .collect();
  },
});

/**
 * status / assignee / priority で絞り込んだプロジェクトの Task 一覧（MCP list_tasks 用）。
 * 全件転送してクライアント側でフィルタする代わりに、条件に応じたインデックスで
 * サーバー側に絞り込みを寄せる（Issue #19）:
 * - assignee 指定あり → by_assignee で担当者の Task だけ読み、project/status を照合
 * - status のみ → by_project_and_status で該当列だけ読む
 * - 指定なし → by_project（listByProject と同じ読み取り）
 *
 * priority にはインデックスを追加せず、上記いずれの分岐でも読み取り後のメモリ
 * フィルタで適用する（既存の assignee×status 併用と同じ後段フィルタ方式・Issue #94）。
 */
export const listFiltered = query({
  args: {
    project: v.id("projects"),
    status: v.optional(taskStatus),
    assignee: v.optional(v.id("members")),
    priority: v.optional(taskPriority),
    accessToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireActor(ctx, args.accessToken);

    const byPriority = (t: Doc<"tasks">) =>
      args.priority === undefined || t.priority === args.priority;

    if (args.assignee !== undefined) {
      const assignee = args.assignee;
      const tasks = await ctx.db
        .query("tasks")
        .withIndex("by_assignee", (q) => q.eq("assignee", assignee))
        .collect();
      return tasks.filter(
        (t) =>
          t.project === args.project &&
          (args.status === undefined || t.status === args.status) &&
          byPriority(t),
      );
    }
    if (args.status !== undefined) {
      const status = args.status;
      const tasks = await ctx.db
        .query("tasks")
        .withIndex("by_project_and_status", (q) =>
          q.eq("project", args.project).eq("status", status),
        )
        .collect();
      return tasks.filter(byPriority);
    }
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("project", args.project))
      .collect();
    return tasks.filter(byPriority);
  },
});

/**
 * カンバン表示用: 固定6状態の列順で、各列を rank 昇順に整列して返す。
 * 表示の利便のため、各 Task に所属 Issue 番号と担当者名を付与する
 * （member の email 等 PII は返さず name のみ）。
 */
export const board = query({
  args: { project: v.id("projects"), accessToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireActor(ctx, args.accessToken);

    const columnTasks = await Promise.all(
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

    // Issue 番号はタスクが参照する Issue のみ取得する
    // （project 配下の issues 全件 .collect() は避ける・Issue #19）。
    const issueIds = [
      ...new Set(columnTasks.flatMap((c) => c.tasks.map((t) => t.issue))),
    ];
    const issueNumber = new Map<Id<"issues">, number>();
    await Promise.all(
      issueIds.map(async (id) => {
        const issue = await ctx.db.get(id);
        if (issue !== null) issueNumber.set(id, issue.number);
      }),
    );

    // 担当者名は参照された分だけ解決する（members 全件 .collect() は避ける）。
    const memberName = await resolveMemberNames(
      ctx,
      columnTasks.flatMap((c) => c.tasks.map((t) => t.assignee)),
    );

    return columnTasks.map(({ status, tasks }) => ({
      status,
      tasks: tasks.map((t) => ({
        ...t,
        issueNumber: issueNumber.get(t.issue) ?? null,
        assigneeName:
          t.assignee === undefined
            ? null
            : (memberName.get(t.assignee) ?? null),
      })),
    }));
  },
});

/**
 * {key}-{number} 形式の参照から素の Task ドキュメントを解決する。
 * MCP（get_task / task:// リソース）が依存する安定した契約のため、
 * 表示用の join は付与しない（詳細画面は getDetail を使う）。
 */
export const getByRef = query({
  args: {
    projectKey: v.string(),
    number: v.number(),
    accessToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireActor(ctx, args.accessToken);

    const project = await findProjectByKey(ctx, args.projectKey);
    if (project === null) return null;

    return await ctx.db
      .query("tasks")
      .withIndex("by_project_and_number", (q) =>
        q.eq("project", project._id).eq("number", args.number),
      )
      .unique();
  },
});

/**
 * Task 詳細画面用に、表示に必要な関連情報を付与して Task を解決する。
 * member の PII（email 等）は返さず name のみ。
 * - 親 Issue の number/title（パンくず用）
 * - assignee/createdBy の表示名
 * - GitLink 一覧（repository.remoteUrl を join）
 * - projectKey（表示・リンク生成用）
 */
export const getDetail = query({
  args: {
    projectKey: v.string(),
    number: v.number(),
    accessToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireActor(ctx, args.accessToken);

    const project = await findProjectByKey(ctx, args.projectKey);
    if (project === null) return null;

    const task = await ctx.db
      .query("tasks")
      .withIndex("by_project_and_number", (q) =>
        q.eq("project", project._id).eq("number", args.number),
      )
      .unique();
    if (task === null) return null;

    const issue = await ctx.db.get(task.issue);

    const links = await ctx.db
      .query("gitLinks")
      .withIndex("by_task", (q) => q.eq("task", task._id))
      .collect();
    const gitLinks = await Promise.all(
      links.map(async (link) => {
        const repository = await ctx.db.get(link.repository);
        return { ...link, remoteUrl: repository?.remoteUrl ?? null };
      }),
    );

    return {
      ...task,
      projectKey: project.key,
      issueNumber: issue?.number ?? null,
      issueTitle: issue?.title ?? null,
      assigneeName: await resolveMemberName(ctx, task.assignee),
      createdByName: await resolveMemberName(ctx, task.createdBy),
      gitLinks,
    };
  },
});
