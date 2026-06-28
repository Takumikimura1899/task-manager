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
}: {
  task: Doc<"tasks">;
  projectKey: string;
}) {
  return (
    <article className={s.card}>
      <span className={s.ref}>
        {projectKey}-{task.number}
      </span>
      <h3 className={s.title}>{task.title}</h3>
      <span className={s.priority}>
        優先度: {PRIORITY_LABELS[task.priority]}
      </span>
    </article>
  );
}
