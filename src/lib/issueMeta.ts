import type { Doc } from "../../convex/_generated/dataModel";
import type { Priority } from "./taskMeta";

/** Issue 派生ステータス（§5.1）の表示ラベル。一覧・詳細で共有する。 */
export const ISSUE_STATUS_LABELS = {
  open: "未着手",
  in_progress: "着手中",
  done: "完了",
  canceled: "中止",
} as const;

export type IssueStatus = keyof typeof ISSUE_STATUS_LABELS;

/**
 * issues.list が返す Issue（派生ステータス・配下 Task の集計を付与した形）。
 * IssuesView が一箇所で購読し、IssueStats / IssueTable へ props として配る
 * （BoardTask と同様、クエリの返り値形状を手動で写した型・src/lib/board.ts 参照）。
 */
export type IssueSummary = Omit<Doc<"issues">, "priority"> & {
  priority: Priority;
  status: IssueStatus;
  taskCount: number;
  doneCount: number;
  estimateTotal: number;
  actualTotal: number;
};
