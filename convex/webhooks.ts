import { v } from "convex/values";
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

// --- internal API -----------------------------------------------------------

/**
 * URL 候補からリポジトリを探し、復号した webhookSecret を返す（署名検証用）。
 * MVP 規模のため全件走査で remoteUrl を突き合わせる。
 */
export const findRepositoryByUrls = internalQuery({
  args: { urls: v.array(v.string()) },
  handler: async (ctx, { urls }) => {
    const repos = await ctx.db.query("repositories").collect();
    const repo = repos.find((r) => urls.includes(r.remoteUrl));
    if (repo === undefined) return null;

    const key = process.env.WEBHOOK_ENCRYPTION_KEY;
    if (key === undefined || key === "") {
      throw new Error("WEBHOOK_ENCRYPTION_KEY が設定されていません");
    }
    const secret = await decryptSecret(repo.webhookSecret, key);
    return { repositoryId: repo._id, projectId: repo.project, secret };
  },
});

/** delivery を記録する。新規なら true、既処理（重複）なら false を返す。 */
export const tryMarkDelivery = internalMutation({
  args: { deliveryId: v.string() },
  handler: async (ctx, { deliveryId }) => {
    const existing = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_delivery", (q) => q.eq("deliveryId", deliveryId))
      .unique();
    if (existing !== null) return false;
    await ctx.db.insert("webhookDeliveries", { deliveryId });
    return true;
  },
});

/** ブランチ作成: ブランチ名から参照を抽出し、todo → in_progress（§5）。 */
export const handleBranchCreated = internalMutation({
  args: { projectId: v.id("projects"), branchName: v.string() },
  handler: async (ctx, { projectId, branchName }) => {
    const ref = extractTaskRef(branchName);
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
  },
});

/** push: 各コミットメッセージの [KEY-番号] に GitLink(commit) を追加（遷移なし）。 */
export const handlePush = internalMutation({
  args: {
    repositoryId: v.id("repositories"),
    projectId: v.id("projects"),
    commits: v.array(
      v.object({ message: v.string(), sha: v.string(), url: v.string() }),
    ),
  },
  handler: async (ctx, { repositoryId, projectId, commits }) => {
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
  },
});

/** pull_request: GitLink(pull_request) を upsert し、action に応じて自動遷移（§5）。 */
export const handlePullRequest = internalMutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    // 参照は タイトル → 本文 → ブランチ名 の順で探す
    const ref =
      extractTaskRef(args.title) ??
      extractTaskRef(args.body) ??
      extractTaskRef(args.branch);
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
  },
});
