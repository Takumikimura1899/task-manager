import type { Doc } from "../../convex/_generated/dataModel";

export type Priority = Doc<"tasks">["priority"];
export type TaskStatus = Doc<"tasks">["status"];

/** 作成フォームの優先度セレクト用の選択肢（§3 taskPriority に対応）。 */
export const PRIORITY_OPTIONS: readonly { value: Priority; label: string }[] = [
  { value: "none", label: "なし" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "urgent", label: "緊急" },
];

/** 優先度の値→表示ラベル（PRIORITY_OPTIONS の単一定義から導出）。 */
export const PRIORITY_LABELS: Record<Priority, string> = Object.fromEntries(
  PRIORITY_OPTIONS.map((o) => [o.value, o.label]),
) as Record<Priority, string>;

/** §5 固定6状態の列順（カンバン列・配下Taskのグルーピングで共有）。 */
export const TASK_STATUS_ORDER: readonly TaskStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
];

/** §5 固定6状態の表示ラベル（カンバン・詳細画面で共有）。 */
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "バックログ",
  todo: "未着手",
  in_progress: "進行中",
  in_review: "レビュー中",
  done: "完了",
  canceled: "キャンセル",
};
