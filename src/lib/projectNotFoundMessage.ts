/**
 * プロジェクトが選択できない（`selected` が null／project が存在しない）
 * 場合の空状態文言（UI文言・配置規約.md §6-3）。Board / ActiveIssueStrip /
 * GanttView / IssuesView の4箇所で同一文言を使うため、コピーの分裂を防ぐ
 * ためにここへ一元化する。
 *
 * `ProjectMembers.tsx` の「プロジェクトが見つかりませんでした。」は
 * projectKey を URL から直接解決する別文脈のため対象外
 * （UI文言・配置規約.md §6-3 参照）。
 */
export const PROJECT_NOT_FOUND_MESSAGE =
  "プロジェクトが見つかりませんでした。ヘッダーの「プロジェクト」から選び直してください。";
