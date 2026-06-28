import { Link } from "react-router-dom";
import type { Doc } from "../../../convex/_generated/dataModel";
import s from "./TaskCard.module.css";

const PRIORITY_LABELS: Record<Doc<"tasks">["priority"], string> = {
  none: "—",
  low: "低",
  medium: "中",
  high: "高",
  urgent: "緊急",
};

export function TaskCard({
  task,
  projectKey,
  issueNumber = null,
  assigneeName = null,
}: {
  task: Doc<"tasks">;
  projectKey: string;
  issueNumber?: number | null;
  assigneeName?: string | null;
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
        {issueNumber !== null && (
          <span className={s.issue}>Issue #{issueNumber}</span>
        )}
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
}
