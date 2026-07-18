import type { ReactNode } from "react";
import type { IssueStatus } from "../../lib/issueMeta";
import type { TaskStatus } from "../../lib/taskMeta";
import s from "./Badge.module.css";

/** バッジで表現できるステータス（Issue 派生ステータス / Task 固定6状態）。 */
export type BadgeStatus = IssueStatus | TaskStatus;

// ステータス別の上書きスタイル。未着手系（open / todo / backlog）は
// 基底 .badge の muted 表示のままにするため、ここには持たない。
const STATUS_CLASS: Partial<Record<BadgeStatus, string>> = {
  in_progress: s.in_progress,
  in_review: s.in_review,
  done: s.done,
  canceled: s.canceled,
};

/**
 * Issue / Task のステータスバッジ。ステータスに応じた配色を適用する。
 * 表示ラベルはドメインごとにステータス集合が異なる（Task のみ backlog /
 * in_review を持つ）ため、呼び出し側が children で渡す。
 */
export function Badge({
  status,
  children,
}: {
  status: BadgeStatus;
  children: ReactNode;
}) {
  const statusClass = STATUS_CLASS[status];
  return (
    <span
      className={
        statusClass === undefined ? s.badge : `${s.badge} ${statusClass}`
      }
    >
      {children}
    </span>
  );
}
