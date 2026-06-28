import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { Doc } from "../../../convex/_generated/dataModel";
import type { BoardTask } from "../../lib/board";
import { SortableTaskCard } from "../TaskCard/SortableTaskCard";
import s from "./Board.module.css";

/**
 * カンバンの1列。列全体を droppable にし（空列でもドロップ可能）、
 * 中身は縦方向の SortableContext として並べる。
 */
export function Column({
  status,
  label,
  tasks,
  projectKey,
}: {
  status: Doc<"tasks">["status"];
  label: string;
  tasks: BoardTask[];
  projectKey: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <section className={s.column}>
      <header className={s.header}>
        {label}
        <span className={s.count}>{tasks.length}</span>
      </header>
      <SortableContext
        items={tasks.map((t) => t._id)}
        strategy={verticalListSortingStrategy}
      >
        <div
          className={`${s.body} ${isOver ? s.bodyOver : ""}`}
          ref={setNodeRef}
        >
          {tasks.map((task) => (
            <SortableTaskCard
              key={task._id}
              projectKey={projectKey}
              task={task}
            />
          ))}
        </div>
      </SortableContext>
    </section>
  );
}
