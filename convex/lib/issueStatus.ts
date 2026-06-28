import type { TaskStatus } from "./taskStatus";

/**
 * Issue 派生ステータス（基本設計書 §5.1 / ADR-10）。
 *
 * Issue は独立した状態機械を持たず、子 Task 群の状態から一意に算出する。
 * 状態の二重管理と Task との乖離を避けるための純粋関数（DB 非依存）。
 * Task 遷移時に再計算して利用する。
 */

export const ISSUE_STATUSES = [
  "open",
  "in_progress",
  "done",
  "canceled",
] as const;

export type IssueStatus = (typeof ISSUE_STATUSES)[number];

// 「着手済み」とみなす Task 状態（1つでもあれば Issue は in_progress）。
const STARTED: readonly TaskStatus[] = ["in_progress", "in_review", "done"];

/**
 * 子 Task の状態集合から Issue ステータスを算出する（§5.1）。
 * - active = canceled 以外の Task。
 * - active が空（全 canceled）→ canceled
 * - active がすべて done → done
 * - active に着手済み（in_progress/in_review/done）あり → in_progress
 * - それ以外（active が backlog/todo のみ）→ open
 *
 * Issue は常に ≥1 Task を持つ（INVARIANT-5）前提。空入力は退化的に canceled を返す。
 */
export function deriveIssueStatus(
  taskStatuses: readonly TaskStatus[],
): IssueStatus {
  const active = taskStatuses.filter((s) => s !== "canceled");
  if (active.length === 0) return "canceled";
  if (active.every((s) => s === "done")) return "done";
  if (active.some((s) => STARTED.includes(s))) return "in_progress";
  return "open";
}
