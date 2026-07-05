import { type ObjectType, v } from "convex/values";
import {
  type MutationCtx,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { decryptSecret } from "./lib/crypto";
import {
  type TaskRef,
  extractTaskRef,
  extractTaskRefsFromCommit,
} from "./lib/gitRef";
import { type GitEventKind, transitionForGitEvent } from "./lib/gitAutomation";
import { lastRankInColumn } from "./tasks";
import { upsertGitLink } from "./gitLinks";
import { rankBetween } from "./lib/rank";

/**
 * GitHub Webhook の処理（基本設計書 §7 / §5 自動遷移）。
 *
 * HTTP エンドポイント（convex/http.ts）から internal 関数として呼ばれる。
 * 署名検証は http.ts 側で行い、ここではリポジトリ解決・冪等化・イベント反映を担う。
 * 冪等マーキングとイベント反映は processEvent が単一トランザクションで行い、
 * 処理が失敗した場合はマーカーごとロールバックして GitHub の再送で再処理できる
 * ようにする（at-least-once、Issue #12）。
 * 解析失敗・未知参照はサイレントに握り潰さず console.error に残す（§7）。
 */

// --- 内部ヘルパー -----------------------------------------------------------

/** ブランチ名/PR から得た参照と一致するタスクを探す（プロジェクトキーも照合）。 */
async function findTask(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  ref: TaskRef,
): Promise<Doc<"tasks"> | null> {
  const project = await ctx.db.get(projectId);
  if (project === null || project.key !== ref.key) {
    return null; // 別プロジェクトの参照、または不一致
  }
  return await ctx.db
    .query("tasks")
    .withIndex("by_project_and_number", (q) =>
      q.eq("project", projectId).eq("number", ref.number),
    )
    .unique();
}

/** Git イベントに応じた自動遷移を適用する（適用不要なら何もしない）。 */
async function applyTransition(
  ctx: MutationCtx,
  task: Doc<"tasks">,
  kind: GitEventKind,
): Promise<void> {
  const to = transitionForGitEvent(kind, task.status);
  if (to === null) return;
  const tail = await lastRankInColumn(ctx, task.project, to);
  await ctx.db.patch(task._id, {
    status: to,
    rank: rankBetween(tail, null),
    revision: task.revision + 1,
    updatedAt: Date.now(),
  });
}

// --- internal API（署名検証用のリポジトリ解決） --------------------------------

/**
 * URL 候補からリポジトリを探し、復号した webhookSecret を返す（署名検証用）。
 * 全件走査は避け、候補 URL ごとに by_remoteUrl インデックスで逆引きする（Issue #19）。
 */
export const findRepositoryByUrls = internalQuery({
  args: { urls: v.array(v.string()) },
  handler: async (ctx, { urls }) => {
    let repo: Doc<"repositories"> | null = null;
    for (const url of urls) {
      repo = await ctx.db
        .query("repositories")
        .withIndex("by_remoteUrl", (q) => q.eq("remoteUrl", url))
        .first();
      if (repo !== null) break;
    }
    if (repo === null) return null;

    const key = process.env.WEBHOOK_ENCRYPTION_KEY;
    if (key === undefined || key === "") {
      throw new Error("WEBHOOK_ENCRYPTION_KEY が設定されていません");
    }
    const secret = await decryptSecret(repo.webhookSecret, key);
    return { repositoryId: repo._id, projectId: repo.project, secret };
  },
});

// --- イベント処理の本体（processEvent と各 internalMutation で共有） -----------

const branchCreatedFields = {
  projectId: v.id("projects"),
  branchName: v.string(),
};

/** ブランチ作成: ブランチ名から参照を抽出し、todo → in_progress（§5）。 */
async function processBranchCreated(
  ctx: MutationCtx,
  { projectId, branchName }: ObjectType<typeof branchCreatedFields>,
): Promise<void> {
  const project = await ctx.db.get(projectId);
  if (project === null) {
    console.error(`[webhook] プロジェクトが存在しない: ${projectId}`);
    return;
  }
  const ref = extractTaskRef(branchName, project.key);
  if (ref === null) {
    console.error(`[webhook] ブランチ名にタスク参照なし: ${branchName}`);
    return;
  }
  const task = await findTask(ctx, projectId, ref);
  if (task === null) {
    console.error(`[webhook] 該当タスクなし: ${ref.key}-${ref.number}`);
    return;
  }
  await applyTransition(ctx, task, "branch_created");
}

const pushFields = {
  repositoryId: v.id("repositories"),
  projectId: v.id("projects"),
  commits: v.array(
    v.object({ message: v.string(), sha: v.string(), url: v.string() }),
  ),
};

/** push: 各コミットメッセージの [KEY-番号] に GitLink(commit) を追加（遷移なし）。 */
async function processPush(
  ctx: MutationCtx,
  { repositoryId, projectId, commits }: ObjectType<typeof pushFields>,
): Promise<void> {
  for (const commit of commits) {
    const refs = extractTaskRefsFromCommit(commit.message);
    for (const ref of refs) {
      const task = await findTask(ctx, projectId, ref);
      if (task === null) {
        console.error(
          `[webhook] commit ${commit.sha} の参照に該当タスクなし: ${ref.key}-${ref.number}`,
        );
        continue;
      }
      await upsertGitLink(ctx, {
        task: task._id,
        repository: repositoryId,
        type: "commit",
        externalRef: commit.sha,
        url: commit.url,
      });
    }
  }
}

const pullRequestFields = {
  repositoryId: v.id("repositories"),
  projectId: v.id("projects"),
  action: v.string(),
  merged: v.boolean(),
  draft: v.boolean(),
  number: v.number(),
  url: v.string(),
  title: v.string(),
  body: v.string(),
  branch: v.string(),
};

/** pull_request: GitLink(pull_request) を upsert し、action に応じて自動遷移（§5）。 */
async function processPullRequest(
  ctx: MutationCtx,
  args: ObjectType<typeof pullRequestFields>,
): Promise<void> {
  const project = await ctx.db.get(args.projectId);
  if (project === null) {
    console.error(`[webhook] プロジェクトが存在しない: ${args.projectId}`);
    return;
  }
  // 参照は タイトル → 本文 → ブランチ名 の順で探す（プロジェクトキー一致のみ対象）
  const ref =
    extractTaskRef(args.title, project.key) ??
    extractTaskRef(args.body, project.key) ??
    extractTaskRef(args.branch, project.key);
  if (ref === null) {
    console.error(`[webhook] PR #${args.number} にタスク参照なし`);
    return;
  }
  const task = await findTask(ctx, args.projectId, ref);
  if (task === null) {
    console.error(
      `[webhook] PR #${args.number} の参照に該当タスクなし: ${ref.key}-${ref.number}`,
    );
    return;
  }

  const prState: Doc<"gitLinks">["prState"] = args.merged
    ? "merged"
    : args.action === "closed"
      ? "closed"
      : args.draft
        ? "draft"
        : "open";

  await upsertGitLink(ctx, {
    task: task._id,
    repository: args.repositoryId,
    type: "pull_request",
    externalRef: String(args.number),
    url: args.url,
    prState,
  });

  let kind: GitEventKind | null = null;
  if (args.action === "opened" || args.action === "reopened") {
    kind = "pr_opened";
  } else if (args.action === "ready_for_review") {
    kind = "pr_ready";
  } else if (args.action === "closed") {
    kind = args.merged ? "pr_merged" : "pr_closed";
  }
  if (kind !== null) {
    await applyTransition(ctx, task, kind);
  }
}

/** delivery を記録する。新規なら true、既処理（重複）なら false を返す。 */
async function markDeliveryIfNew(
  ctx: MutationCtx,
  deliveryId: string,
): Promise<boolean> {
  const existing = await ctx.db
    .query("webhookDeliveries")
    .withIndex("by_delivery", (q) => q.eq("deliveryId", deliveryId))
    .unique();
  if (existing !== null) return false;
  await ctx.db.insert("webhookDeliveries", { deliveryId });
  return true;
}

// --- internal API（HTTP 層から呼ばれる） --------------------------------------

/**
 * Webhook イベントのエントリポイント。冪等マーキングとイベント反映を
 * 単一トランザクションで行う（Issue #12）。
 *
 * - 同一 deliveryId の再送は "duplicate" を返し、イベント処理をスキップする。
 * - イベント処理が throw した場合は冪等マーカーごとロールバックされるため、
 *   GitHub の再送で再処理できる（at-least-once）。
 * - deliveryId が空文字の場合は冪等化せず常に処理する（HTTP 層がヘッダ欠落を
 *   400 で拒否するため通常経路では到達しない、防御的な分岐。Issue #16）。
 */
export const processEvent = internalMutation({
  args: {
    deliveryId: v.string(),
    event: v.union(
      v.object({ kind: v.literal("branch_created"), ...branchCreatedFields }),
      v.object({ kind: v.literal("push"), ...pushFields }),
      v.object({ kind: v.literal("pull_request"), ...pullRequestFields }),
      // 未対応イベント: delivery の記録のみ行い、本体は処理しない（現行挙動の維持）
      v.object({ kind: v.literal("ignored"), name: v.string() }),
    ),
  },
  handler: async (ctx, { deliveryId, event }) => {
    if (deliveryId !== "" && !(await markDeliveryIfNew(ctx, deliveryId))) {
      return "duplicate" as const;
    }
    switch (event.kind) {
      case "branch_created":
        await processBranchCreated(ctx, event);
        break;
      case "push":
        await processPush(ctx, event);
        break;
      case "pull_request":
        await processPullRequest(ctx, event);
        break;
      case "ignored":
        console.error(`[webhook] 未対応イベント: ${event.name}`);
        break;
    }
    return "processed" as const;
  },
});

// --- internal API（イベント単体の入口。実処理は process* ヘルパーと共有） -------

/** ブランチ作成イベント単体を処理する（冪等化なし。結合テスト・補正処理用）。 */
export const handleBranchCreated = internalMutation({
  args: branchCreatedFields,
  handler: processBranchCreated,
});

/** push イベント単体を処理する（冪等化なし。結合テスト・補正処理用）。 */
export const handlePush = internalMutation({
  args: pushFields,
  handler: processPush,
});

/** pull_request イベント単体を処理する（冪等化なし。結合テスト・補正処理用）。 */
export const handlePullRequest = internalMutation({
  args: pullRequestFields,
  handler: processPullRequest,
});
