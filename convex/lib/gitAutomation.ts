/**
 * Git 駆動の自動ステータス遷移（基本設計書 §5「Git駆動の自動遷移マッピング」）。
 *
 * 原則: 前進方向のみ・人間の手動操作を上書きしない。
 * これを状態機械（canTransition）の再利用で表現する。各 Git イベントには目標状態が
 * 1つ対応し、「現在状態から目標へ状態機械が許す遷移のときだけ適用する」。
 * これにより、例えば手動で done にしたタスクを PR open で in_progress に戻すことはない。
 */
import { type TaskStatus, canTransition } from "./taskStatus";

export type GitEventKind =
  | "branch_created" // ブランチ作成 → in_progress（todo のときのみ）
  | "pr_opened" // PR open（Draft 含む）→ in_progress
  | "pr_ready" // PR ready for review（Draft 解除）→ in_review
  | "pr_merged" // PR merged → done
  | "pr_closed"; // PR closed（未マージ）→ in_progress（done 以外なら差し戻し）

// 前進イベントの目標状態（pr_closed は差し戻しのため別扱い）
const FORWARD_TARGET: Record<Exclude<GitEventKind, "pr_closed">, TaskStatus> = {
  branch_created: "in_progress",
  pr_opened: "in_progress",
  pr_ready: "in_review",
  pr_merged: "done",
};

// 前進方向の判定に使う状態の順序（canceled は順序を持たず自動遷移対象外）
const STATUS_ORDER: Record<TaskStatus, number> = {
  backlog: 0,
  todo: 1,
  in_progress: 2,
  in_review: 3,
  done: 4,
  canceled: -1,
};

/**
 * Git イベントに対する自動遷移先を返す。適用すべきでなければ null。
 *
 * - canceled は終端のため自動遷移しない。
 * - pr_closed（未マージ）のみ、in_review からの差し戻し（→ in_progress）を行う（§5）。
 * - それ以外は「前進のみ」: 現在状態が目標より手前で、かつ状態機械が許す
 *   1ステップ遷移のときだけ適用する。これにより手動操作（先に進めた／done にした）を
 *   後退・上書きしない。
 */
export function transitionForGitEvent(
  kind: GitEventKind,
  currentStatus: TaskStatus,
): TaskStatus | null {
  if (currentStatus === "canceled") return null;

  if (kind === "pr_closed") {
    return currentStatus === "in_review" ? "in_progress" : null;
  }

  const target = FORWARD_TARGET[kind];
  const isForward = STATUS_ORDER[currentStatus] < STATUS_ORDER[target];
  return isForward && canTransition(currentStatus, target) ? target : null;
}
