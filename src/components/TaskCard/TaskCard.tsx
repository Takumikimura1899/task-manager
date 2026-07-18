import { memo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Doc } from "../../../convex/_generated/dataModel";
import { formatIssueRef } from "../../lib/formatIssueRef";
import { PRIORITY_LABELS } from "../../lib/taskMeta";
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
}: {
  task: Doc<"tasks">;
  projectKey: string;
  issueNumber?: number | null;
  assigneeName?: string | null;
  /** D&D 用のドラッグハンドル（SortableTaskCard が注入する）。表示位置だけをここで決める。 */
  dragHandle?: ReactNode;
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
        <span className={s.priority}>
          優先度: {PRIORITY_LABELS[task.priority]}
        </span>
        {assigneeName !== null && (
          <span className={s.assignee}>{assigneeName}</span>
        )}
      </div>
    </article>
  );
});
