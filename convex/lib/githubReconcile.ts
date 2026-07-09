import type { Id } from "../_generated/dataModel";

/**
 * Webhook reconcile の純粋ロジック（Issue #33 / 基本設計書リスク#5）。
 *
 * GitHub REST API のレスポンス（PR・commit のスナップショット）を、既存の
 * Webhook 処理経路（webhooks.processEvent）へ流し込めるイベント形式に変換する。
 * GitHub API の fetch（外部依存）は convex/reconcile.ts の action 側が担い、
 * ここは「取得結果 → イベント」の変換のみを扱う（テスト容易性のための分離）。
 *
 * 冪等化の設計:
 * - deliveryId は `reconcile:` プレフィクスで GitHub の X-GitHub-Delivery
 *   （UUID）と衝突しない形式にする。
 * - commit は sha、PR は number + updated_at で同定する。同じスナップショットの
 *   再実行（ウィンドウ重複）は webhookDeliveries のマーカーでスキップされ、
 *   PR に新しい活動があれば updated_at が変わるので再処理される。
 * - Webhook で処理済みのイベントは deliveryId が異なるため processEvent を通るが、
 *   反映処理自体がドメインレベルで冪等（GitLink は upsert、自動遷移は前進のみ）
 *   なので二重適用にはならない。
 */

/** 登録リポジトリの reconcile に必要な参照。 */
export type ReconcileRepo = {
  repositoryId: Id<"repositories">;
  projectId: Id<"projects">;
};

/** GitHub REST API: PR オブジェクトのうち参照するフィールド（外部入力のため防御的に扱う）。 */
export type GitHubPullRequest = {
  number?: number;
  state?: string; // "open" | "closed"
  draft?: boolean;
  merged_at?: string | null;
  html_url?: string;
  title?: string;
  body?: string | null;
  updated_at?: string;
  head?: { ref?: string };
};

/** GitHub REST API: commit オブジェクトのうち参照するフィールド。 */
export type GitHubCommit = {
  sha?: string;
  html_url?: string;
  commit?: { message?: string };
};

/**
 * remoteUrl から GitHub の owner/repo を取り出す。
 * https / git@（scp 形式）/ ssh:// の各形式と `.git` サフィックスに対応する。
 * GitHub 形式でない URL は null（呼び出し側がログを残してスキップする）。
 */
export function parseGitHubRepo(
  remoteUrl: string,
): { owner: string; repo: string } | null {
  const match = remoteUrl.match(
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/,
  );
  if (match === null) return null;
  return { owner: match[1], repo: match[2] };
}

/**
 * PR スナップショットの現在状態を Webhook の pull_request イベント相当に変換する。
 *
 * action の合成（Webhook が届いていた場合と同じ最終状態に収束させる）:
 * - merged_at あり           → closed + merged=true  （pr_merged → done）
 * - state=closed（未マージ） → closed + merged=false （pr_closed → 差し戻し）
 * - state=open               → opened               （pr_opened → in_progress）
 *
 * 制約: スナップショットからは「draft で開かれた後に ready_for_review された」
 * 履歴を判別できないため、open な PR は常に opened として扱う。ready_for_review
 * の取りこぼし（in_progress → in_review）は補正されないが、Webhook が本来
 * 起こさない遷移を reconcile が起こす（過剰な前進）よりも安全側に倒す。
 */
export function prSnapshotToEvent(pr: GitHubPullRequest, repo: ReconcileRepo) {
  const merged = pr.merged_at !== null && pr.merged_at !== undefined;
  const number = Number(pr.number ?? 0);
  return {
    deliveryId: `reconcile:${repo.repositoryId}:pr:${number}:${pr.updated_at ?? ""}`,
    event: {
      kind: "pull_request" as const,
      repositoryId: repo.repositoryId,
      projectId: repo.projectId,
      action: pr.state === "closed" ? "closed" : "opened",
      merged,
      draft: Boolean(pr.draft),
      number,
      url: String(pr.html_url ?? ""),
      title: String(pr.title ?? ""),
      body: String(pr.body ?? ""),
      branch: String(pr.head?.ref ?? ""),
    },
  };
}

/**
 * commit を Webhook の push イベント相当（1 commit = 1 イベント）に変換する。
 * commit 単位にするのは、sha を deliveryId に使って個別に冪等化するため
 * （ウィンドウ重複時に「一部だけ処理済みのバッチ」を作らない）。
 */
export function commitToEvent(commit: GitHubCommit, repo: ReconcileRepo) {
  const sha = String(commit.sha ?? "");
  return {
    deliveryId: `reconcile:${repo.repositoryId}:commit:${sha}`,
    event: {
      kind: "push" as const,
      repositoryId: repo.repositoryId,
      projectId: repo.projectId,
      commits: [
        {
          message: String(commit.commit?.message ?? ""),
          sha,
          url: String(commit.html_url ?? ""),
        },
      ],
    },
  };
}

/**
 * PR がウィンドウ内（sinceIso 以降）に更新されたか。
 * GitHub の ISO 8601（UTC・Z サフィックス）同士は辞書順比較で時刻比較できる。
 */
export function prUpdatedSince(
  pr: GitHubPullRequest,
  sinceIso: string,
): boolean {
  return (pr.updated_at ?? "") >= sinceIso;
}
