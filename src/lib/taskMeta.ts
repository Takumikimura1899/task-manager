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

/**
 * 優先度の値→比較用の重み（PRIORITY_OPTIONS の並び順 none→urgent から導出、
 * none=0 … urgent=4）。優先度は文字列のため `<`/`>` で直接比較できず、ソート
 * （#93）で文字列比較の誤りを防ぐためにこの数値を使う。
 */
export const PRIORITY_WEIGHT: Record<Priority, number> = Object.fromEntries(
  PRIORITY_OPTIONS.map((o, i) => [o.value, i]),
) as Record<Priority, number>;

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
