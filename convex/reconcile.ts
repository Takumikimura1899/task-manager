import { internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import {
  type GitHubCommit,
  type GitHubPullRequest,
  type ReconcileRepo,
  commitToEvent,
  parseGitHubRepo,
  prSnapshotToEvent,
  prUpdatedSince,
} from "./lib/githubReconcile";

/**
 * Webhook reconcile（Issue #33 / 基本設計書リスク#5 / 技術スタック定義書 §6）。
 *
 * GitHub Webhook には到達保証がないため、crons（convex/crons.ts）から定期的に
 * GitHub REST API をポーリングし、直近ウィンドウ内のイベント（push の commit・
 * PR の状態変化）を既存の Webhook 処理経路（webhooks.processEvent）へ流し込んで
 * 取りこぼしを補正する。処理ロジックは複製せず、冪等化（webhookDeliveries
 * マーカー + ドメインレベルの upsert / 前進のみ遷移）も既存経路のものを使う。
 *
 * スコープ（過剰な汎用化はしない）:
 * - 全履歴同期ではなく「直近ウィンドウの補正」のみ。ウィンドウは実行間隔の
 *   2倍にとり、1回の実行失敗までは次回実行でカバーされる。
 * - branch 作成イベントは補正対象外。GitHub API に「最近作られたブランチ」を
 *   差分取得する手段がなく、branch_created の遷移（todo → in_progress）は
 *   その後の PR open（pr_opened）でも同じ状態に収束するため。
 */

/** ポーリングウィンドウ。crons.ts の実行間隔（30分）の2倍（1回の失敗を許容）。 */
export const RECONCILE_LOOKBACK_MS = 60 * 60 * 1000;

/** 1リポジトリ・1エンドポイントあたりの取得上限（直近ウィンドウの補正には十分）。 */
const PAGE_SIZE = 100;

/** reconcile 対象の登録リポジトリ一覧（webhookSecret は返さない）。 */
export const listForReconcile = internalQuery({
  args: {},
  handler: async (ctx) => {
    // repositories はプロジェクトごとの連携先で件数は小さい前提（全件走査で可）
    const repos = await ctx.db.query("repositories").collect();
    return repos.map((repo) => ({
      repositoryId: repo._id,
      projectId: repo.project,
      remoteUrl: repo.remoteUrl,
    }));
  },
});

type RepoForReconcile = ReconcileRepo & { remoteUrl: string };

async function fetchGitHub(
  url: string,
  token: string,
): Promise<globalThis.Response> {
  return await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "task-manager-webhook-reconcile",
    },
  });
}

/** since 以降の commit 一覧を取得する（push イベントの補正対象）。 */
async function fetchRecentCommits(
  base: string,
  token: string,
  since: string,
): Promise<GitHubCommit[]> {
  const url = `${base}/commits?since=${encodeURIComponent(since)}&per_page=${PAGE_SIZE}`;
  const res = await fetchGitHub(url, token);
  // 409 Conflict は「空リポジトリ」（コミットが1つもない）。取りこぼしも存在しない
  if (res.status === 409) return [];
  if (!res.ok) {
    throw new Error(`GitHub API が ${res.status} を返しました: ${url}`);
  }
  return (await res.json()) as GitHubCommit[];
}

/** since 以降に更新された PR 一覧を取得する（pull_request イベントの補正対象）。 */
async function fetchRecentPullRequests(
  base: string,
  token: string,
  since: string,
): Promise<GitHubPullRequest[]> {
  const url = `${base}/pulls?state=all&sort=updated&direction=desc&per_page=${PAGE_SIZE}`;
  const res = await fetchGitHub(url, token);
  if (!res.ok) {
    throw new Error(`GitHub API が ${res.status} を返しました: ${url}`);
  }
  const pulls = (await res.json()) as GitHubPullRequest[];
  return pulls.filter((pr) => prUpdatedSince(pr, since));
}

/**
 * 1リポジトリ分の reconcile。GitHub API から直近ウィンドウのイベントを取得し、
 * 既存の Webhook 経路（processEvent）へ1件ずつ流し込む。
 * GitHub 形式でない remoteUrl はリトライで直らない構成不備のため、ログを残して
 * スキップする（実行全体の失敗にはしない）。
 */
async function reconcileRepository(
  ctx: ActionCtx,
  repo: RepoForReconcile,
  token: string,
  since: string,
): Promise<void> {
  const parsed = parseGitHubRepo(repo.remoteUrl);
  if (parsed === null) {
    console.error(
      `[reconcile] GitHub 形式でない remoteUrl のためスキップ: ${repo.remoteUrl}`,
    );
    return;
  }
  const base = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`;
  const commits = await fetchRecentCommits(base, token, since);
  const pulls = await fetchRecentPullRequests(base, token, since);
  const events = [
    ...commits.map((commit) => commitToEvent(commit, repo)),
    ...pulls.map((pr) => prSnapshotToEvent(pr, repo)),
  ];
  for (const { deliveryId, event } of events) {
    await ctx.runMutation(internal.webhooks.processEvent, {
      deliveryId,
      event,
    });
  }
}

/**
 * reconcile のエントリポイント（crons から定期実行）。
 *
 * - GITHUB_TOKEN 未設定時は補正できないため、ログを残してスキップする
 *   （サイレント失敗の回避。未認証だと API 制限が 60 req/h しかないため
 *   トークンを必須とする）。
 * - 1リポジトリの失敗（API エラー等）は他リポジトリの補正を止めない。
 *   失敗はログに残したうえで、最後にまとめて throw して呼び出し元
 *   （cron の実行ログ）へ伝播させる。
 */
export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    const token = process.env.GITHUB_TOKEN;
    if (token === undefined || token === "") {
      console.error(
        "[reconcile] GITHUB_TOKEN が未設定のため reconcile をスキップします（convex env set GITHUB_TOKEN で設定してください）",
      );
      return null;
    }

    const repos: RepoForReconcile[] = await ctx.runQuery(
      internal.reconcile.listForReconcile,
      {},
    );
    const since = new Date(Date.now() - RECONCILE_LOOKBACK_MS).toISOString();

    const failures: string[] = [];
    for (const repo of repos) {
      try {
        await reconcileRepository(ctx, repo, token, since);
      } catch (e) {
        console.error(`[reconcile] ${repo.remoteUrl} の補正に失敗:`, e);
        failures.push(repo.remoteUrl);
      }
    }
    if (failures.length > 0) {
      throw new Error(
        `[reconcile] ${failures.length}/${repos.length} 件のリポジトリで補正に失敗: ${failures.join(", ")}`,
      );
    }
    return null;
  },
});
