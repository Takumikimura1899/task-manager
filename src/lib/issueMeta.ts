/** Issue 派生ステータス（§5.1）の表示ラベル。一覧・詳細で共有する。 */
export const ISSUE_STATUS_LABELS = {
  open: "未着手",
  in_progress: "着手中",
  done: "完了",
  canceled: "中止",
} as const;

export type IssueStatus = keyof typeof ISSUE_STATUS_LABELS;
