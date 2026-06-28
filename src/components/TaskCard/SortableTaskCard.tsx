import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { BoardTask } from "../../lib/board";
import { TaskCard } from "./TaskCard";
import s from "./TaskCard.module.css";

/**
 * TaskCard を @dnd-kit の sortable アイテムとしてラップする。
 * 表示は TaskCard（表示専任）に委譲し、ここは D&D の配線だけを担う。
 * transform はドラッグ追従のため動的値であり、インラインstyleが正となる。
 */
export function SortableTaskCard({
  task,
  projectKey,
}: {
  task: BoardTask;
  projectKey: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task._id });

  return (
    <div
      className={`${s.sortable} ${isDragging ? s.dragging : ""}`}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
    >
      <TaskCard
        assigneeName={task.assigneeName}
        issueNumber={task.issueNumber}
        projectKey={projectKey}
        task={task}
      />
    </div>
  );
}
