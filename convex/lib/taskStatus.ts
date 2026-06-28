/**
 * タスク状態機械（基本設計書 §5「ステータスワークフロー（固定6状態）」）
 *
 * 遷移規則を Core ロジックに単一実装し、UI・MCP・Webhook の全経路で共有する。
 * 保存層（schema）ではなく、このロジックで状態の妥当性（§3 INVARIANT-4）を強制する。
 *
 * このモジュールは外部依存を持たない純粋関数のみで構成する（DB 非依存・テスト容易）。
 */

export const TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * 各状態から遷移可能な次状態の集合（§5）。
 * - 前進: backlog → todo → in_progress → in_review → done
 *   （隣接1ステップのみ。スキップ前進は規律維持=ADR-6 のため許可しない）
 * - 差し戻し: in_review → in_progress のみ許可。それ以外の逆行は拒否。
 * - canceled: アクティブな任意状態から遷移可能（破壊的操作）。
 * - done / canceled は終端状態（そこからの遷移はない。再オープンは MVP 非対象）。
 */
const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  backlog: ["todo", "canceled"],
  todo: ["in_progress", "canceled"],
  in_progress: ["in_review", "canceled"],
  in_review: ["done", "in_progress", "canceled"], // done=前進 / in_progress=差し戻し
  done: [],
  canceled: [],
};

/** 指定状態から遷移可能な次状態の一覧を返す（UI のアクション表示等に利用）。 */
export function allowedTransitions(from: TaskStatus): readonly TaskStatus[] {
  return TRANSITIONS[from];
}

/**
 * from → to の遷移が状態機械上許可されるかを返す。
 * 同一状態への遷移（from === to）は許可しない（no-op は呼び出し側の責務）。
 */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Human-in-the-Loop 承認が必要な破壊的遷移かを返す
 * （§6 transition_status: done / canceled への遷移は要承認）。
 * MCP・自動化からの遷移時はホスト側で承認プロンプトを必須とする。
 */
const APPROVAL_REQUIRED_TARGETS: readonly TaskStatus[] = ["done", "canceled"];

export function requiresApproval(to: TaskStatus): boolean {
  return APPROVAL_REQUIRED_TARGETS.includes(to);
}
