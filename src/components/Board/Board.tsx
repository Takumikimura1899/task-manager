import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { type BoardTask, neighborRanks } from "../../lib/board";
import { type TaskStatus, TASK_STATUS_LABELS } from "../../lib/taskMeta";
import { TaskCard } from "../TaskCard/TaskCard";
import s from "./Board.module.css";
import { Column } from "./Column";

type BoardColumn = { status: TaskStatus; tasks: BoardTask[] };

/** server スナップショットをローカル編集可能な形へ複製する。 */
function toLocal(columns: readonly BoardColumn[]): BoardColumn[] {
  return columns.map((c) => ({ status: c.status, tasks: [...c.tasks] }));
}

/** id（タスクid or 列status）が属する列の index を返す。 */
function columnIndexOf(board: BoardColumn[], id: string): number {
  const byStatus = board.findIndex((c) => c.status === id);
  if (byStatus !== -1) return byStatus;
  return board.findIndex((c) => c.tasks.some((t) => t._id === id));
}

function errorMessage(e: unknown): string {
  if (e instanceof ConvexError) return String(e.data);
  if (e instanceof Error) return e.message;
  return "操作に失敗しました";
}

export function Board({
  project,
  projectKey,
}: {
  project: Id<"projects">;
  projectKey: string;
}) {
  const columns = useQuery(api.tasks.board, { project });
  const moveTask = useMutation(api.tasks.move);
  const transitionStatus = useMutation(api.tasks.transitionStatus);

  const [board, setBoard] = useState<BoardColumn[] | null>(null);
  const [activeTask, setActiveTask] = useState<BoardTask | null>(null);
  const [error, setError] = useState<string | null>(null);

  // onDragEnd から最新の board を参照するための ref。
  const boardRef = useRef<BoardColumn[] | null>(null);
  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  // server から新しいスナップショットが来たときだけ同期する（ドラッグ中は維持）。
  // activeTask が null に戻っただけでは再同期しない（楽観更新のちらつき防止）。
  const syncedRef = useRef<readonly BoardColumn[] | undefined>(undefined);
  useEffect(() => {
    if (activeTask) return;
    if (columns === undefined) return;
    if (syncedRef.current === columns) return;
    syncedRef.current = columns;
    setBoard(toLocal(columns));
  }, [columns, activeTask]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  if (board === null) {
    return <p className="hint">読み込み中…</p>;
  }

  function findTask(id: string): BoardTask | null {
    for (const column of boardRef.current ?? []) {
      const found = column.tasks.find((t) => t._id === id);
      if (found) return found;
    }
    return null;
  }

  function handleDragStart({ active }: DragStartEvent) {
    setError(null);
    setActiveTask(findTask(active.id as string));
  }

  // ドラッグ中、別の列に重なったらローカル状態上でカードを移し替える。
  function handleDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    const activeId = active.id as string;
    const overId = over.id as string;

    setBoard((prev) => {
      if (!prev) return prev;
      const from = columnIndexOf(prev, activeId);
      const to = columnIndexOf(prev, overId);
      if (from === -1 || to === -1 || from === to) return prev;

      const movingIdx = prev[from].tasks.findIndex((t) => t._id === activeId);
      if (movingIdx === -1) return prev;

      const next = toLocal(prev);
      const [moving] = next[from].tasks.splice(movingIdx, 1);
      const overIdx = next[to].tasks.findIndex((t) => t._id === overId);
      const insertAt = overIdx === -1 ? next[to].tasks.length : overIdx;
      next[to].tasks.splice(insertAt, 0, moving);
      return next;
    });
  }

  async function handleDragEnd({ active, over }: DragEndEvent) {
    const dragged = activeTask;
    setActiveTask(null);
    const current = boardRef.current;
    if (!over || !dragged || !current) return;

    const activeId = active.id as string;
    const overId = over.id as string;
    const toCol = columnIndexOf(current, overId);
    if (toCol === -1) return;

    const targetStatus = current[toCol].status;
    let columnTasks = current[toCol].tasks;
    const oldIndex = columnTasks.findIndex((t) => t._id === activeId);
    const overIndex = columnTasks.findIndex((t) => t._id === overId);

    try {
      if (targetStatus === dragged.status) {
        // 同一列内の並べ替え。位置が変わらないなら何もしない。
        if (overIndex === -1 || overIndex === oldIndex) return;
        columnTasks = arrayMove(columnTasks, oldIndex, overIndex);
        setBoard((prev) =>
          prev === null
            ? prev
            : prev.map((c, i) =>
                i === toCol ? { ...c, tasks: columnTasks } : c,
              ),
        );
        const idx = columnTasks.findIndex((t) => t._id === activeId);
        const { before, after } = neighborRanks(
          columnTasks.map((t) => t.rank),
          idx,
        );
        await moveTask({
          id: dragged._id,
          before,
          after,
          expectedRevision: dragged.revision,
        });
      } else {
        // 列をまたぐ移動は状態遷移（状態機械で検証）。
        // handleDragOver でカードは既に遷移先列のドロップ位置へ配置済みなので、
        // その近傍 rank を渡して末尾固定ではなく任意位置へ挿入する。
        const movedIndex = columnTasks.findIndex((t) => t._id === activeId);
        const { before, after } = neighborRanks(
          columnTasks.map((t) => t.rank),
          movedIndex,
        );
        await transitionStatus({
          id: dragged._id,
          to: targetStatus,
          before,
          after,
          expectedRevision: dragged.revision,
        });
      }
    } catch (e) {
      setError(errorMessage(e));
      // 失敗時は server の真実へ戻す。
      if (columns) {
        syncedRef.current = columns;
        setBoard(toLocal(columns));
      }
    }
  }

  return (
    <DndContext
      collisionDetection={closestCorners}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragStart={handleDragStart}
      sensors={sensors}
    >
      {error !== null && <p className={s.error}>{error}</p>}
      <div className={s.board}>
        {board.map((column) => (
          <Column
            key={column.status}
            label={TASK_STATUS_LABELS[column.status]}
            projectKey={projectKey}
            status={column.status}
            tasks={column.tasks}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask ? (
          <TaskCard
            assigneeName={activeTask.assigneeName}
            issueNumber={activeTask.issueNumber}
            projectKey={projectKey}
            task={activeTask}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
