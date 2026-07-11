import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { memo } from "react";
import type { BoardTask } from "../../lib/board";
import { TaskCard } from "./TaskCard";
import s from "./TaskCard.module.css";

/**
 * TaskCard を @dnd-kit の sortable アイテムとしてラップする。
 * 表示は TaskCard（表示専任）に委譲し、ここは D&D の配線だけを担う。
 * 詳細画面への遷移は TaskCard 内の参照リンク（セマンティックな anchor）が担う。
 *
 * D&D の起点（attributes / listeners）はラッパーではなく専用のドラッグハンドル
 * （native button）に配線する。role="button" の要素が anchor を内包する不正な
 * 入れ子を避け、Enter の意味（リンク遷移 vs ドラッグ開始）を要素ごとに分離する
 * ため（Issue #27）。KeyboardSensor もハンドルをアクティベータとして機能する。
 *
 * transform はドラッグ追従のため動的値であり、インラインstyleが正となる。
 *
 * memo: ドラッグ中は dragOver のたびに Board が再レンダリングされるため、
 * props（task 参照 / projectKey）が不変のカードはスキップする（#80）。
 * useSortable のコンテキスト更新による再レンダリングは transform 追従に
 * 必要なので残る。
 */
export const SortableTaskCard = memo(function SortableTaskCard({
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
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task._id });

  return (
    <div
      className={isDragging ? s.dragging : undefined}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <TaskCard
        assigneeName={task.assigneeName}
        dragHandle={
          <button
            className={s.handle}
            ref={setActivatorNodeRef}
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`${projectKey}-${task.number} を移動`}
          >
            <svg
              aria-hidden="true"
              fill="currentColor"
              height="12"
              viewBox="0 0 16 16"
              width="12"
            >
              <circle cx="5" cy="3" r="1.5" />
              <circle cx="11" cy="3" r="1.5" />
              <circle cx="5" cy="8" r="1.5" />
              <circle cx="11" cy="8" r="1.5" />
              <circle cx="5" cy="13" r="1.5" />
              <circle cx="11" cy="13" r="1.5" />
            </svg>
          </button>
        }
        issueNumber={task.issueNumber}
        projectKey={projectKey}
        task={task}
      />
    </div>
  );
});
