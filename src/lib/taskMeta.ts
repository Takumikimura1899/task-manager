import type { Doc } from "../../convex/_generated/dataModel";

export type Priority = Doc<"tasks">["priority"];

/** 作成フォームの優先度セレクト用の選択肢（§3 taskPriority に対応）。 */
export const PRIORITY_OPTIONS: readonly { value: Priority; label: string }[] = [
  { value: "none", label: "なし" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "urgent", label: "緊急" },
];
