import { memo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Doc } from "../../../convex/_generated/dataModel";
import { formatIssueRef } from "../../lib/formatIssueRef";
import { PRIORITY_LABELS, TASK_STATUS_LABELS } from "../../lib/taskMeta";
import { Badge } from "../Badge/Badge";
import s from "./TaskCard.module.css";

/**
 * memo: props が全て不変ならスキップする（#80）。dragHandle は
 * SortableTaskCard が毎レンダーで生成するため、効果は dragHandle 無しの
 * 利用（DragOverlay 等）に限られる。
 */
export const TaskCard = memo(function TaskCard({
  task,
  projectKey,
  issueNumber = null,
  assigneeName = null,
  dragHandle = null,
  showStatus = false,
}: {
  task: Doc<"tasks">;
  projectKey: string;
  issueNumber?: number | null;
  assigneeName?: string | null;
  /** D&D 用のドラッグハンドル（SortableTaskCard が注入する）。表示位置だけをここで決める。 */
  dragHandle?: ReactNode;
  /**
   * status バッジの表示可否。Board 内ではカラム見出しが status を兼ねるため
   * 既定は false。My Page（期限軸グルーピング）等、status をカード単位で
   * 独立に示す必要がある文脈で true にする。
   */
  showStatus?: boolean;
}) {
  return (
    <article className={s.card}>
      <span className={s.ref}>
        <Link
          className={s.refLink}
          draggable={false}
          to={`/${projectKey}/tasks/${task.number}`}
        >
          {projectKey}-{task.number}
        </Link>
        <span className={s.refEnd}>
          {issueNumber !== null && (
            <span className={s.issue}>{formatIssueRef(issueNumber)}</span>
          )}
          {dragHandle}
        </span>
      </span>
      <h3 className={s.title}>{task.title}</h3>
      <div className={s.meta}>
        <span className={s.metaStart}>
          {showStatus && (
            <Badge status={task.status}>
              {TASK_STATUS_LABELS[task.status]}
            </Badge>
          )}
          <span className={s.priority}>
            優先度: {PRIORITY_LABELS[task.priority]}
          </span>
        </span>
        {assigneeName !== null && (
          <span className={s.assignee}>{assigneeName}</span>
        )}
      </div>
    </article>
  );
});
