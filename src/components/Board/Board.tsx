import {
  closestCorners,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  type BoardTask,
  neighborRanks,
  pickCardFirstCollisions,
  pickPointerScopedCollisions,
  resolveSameColumnTargetIndex,
} from "../../lib/board";
import {
  type TaskStatus,
  TASK_STATUS_LABELS,
  TASK_STATUS_ORDER,
} from "../../lib/taskMeta";
import { Skeleton } from "../Skeleton/Skeleton";
import { TaskCard } from "../TaskCard/TaskCard";
import s from "./Board.module.css";
import { Column } from "./Column";

type BoardColumn = { status: TaskStatus; tasks: BoardTask[] };

const COLUMN_IDS: ReadonlySet<string> = new Set(TASK_STATUS_ORDER);

// 衝突検出はポインタのいる列にスコープする必要があるため、
// 列の所属を知る Board コンポーネント内で組み立てる（下記 collisionDetection）。

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

  /**
   * カードを列コンテナより優先しつつ、候補を「ポインタのいる列」にスコープした
   * 衝突検出（#65）。ドラッグハンドルはカード右上にあり、ポインタが隣列に
   * 入ってもカード矩形は元列に残るため、全列のカードを優先対象にすると
   * rectIntersection が拾う元列のカードに over が吸われ、列またぎが同一列の
   * 並べ替えに誤変換される。ポインタ座標が無い場合（KeyboardSensor）は
   * 従来どおりカード優先→closestCorners のフォールバックで解決する。
   * closestCorners は距離ベースで交差していなくても必ず候補を返すため、
   * カード優先の段階に含めると空列へのドロップが最寄りカード（ドラッグ中の
   * 自分自身など）に吸われて no-op になる——最終手段に限定すること。
   */
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerHits = pointerWithin(args);
    const rectHits = rectIntersection(args);
    const scoped = pickPointerScopedCollisions(
      pointerHits,
      rectHits,
      COLUMN_IDS,
      (cardId) => {
        for (const column of boardRef.current ?? []) {
          if (column.tasks.some((t) => t._id === cardId)) return column.status;
        }
        return null;
      },
    );
    if (scoped) return scoped;
    const overlapping = pickCardFirstCollisions([rectHits], COLUMN_IDS);
    return overlapping.length > 0 ? overlapping : closestCorners(args);
  }, []);

  // 初期ロード中も全画面差し替えにせず、カンバンの列枠を維持したまま
  // カード部分だけをスケルトンで示す（Issue #29）。
  if (board === null) {
    return (
      <output aria-label="ボードを読み込み中" className={s.board}>
        {TASK_STATUS_ORDER.map((status) => (
          <span className={s.column} key={status}>
            <span className={s.header}>{TASK_STATUS_LABELS[status]}</span>
            <span className={s.body}>
              <Skeleton className={s.skeletonCard} />
              <Skeleton className={s.skeletonCard} />
            </span>
          </span>
        ))}
      </output>
    );
  }

  const boardIsEmpty = board.every((column) => column.tasks.length === 0);

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

      // 変化した from / to の2列だけ複製し、他列は同一参照を保つ（#80）。
      // ポインタ移動のたびに呼ばれるため、全列複製だと memo 化した
      // Column の再レンダリング抑止が効かずフレーム落ちの原因になる。
      const fromTasks = [...prev[from].tasks];
      const [moving] = fromTasks.splice(movingIdx, 1);
      const toTasks = [...prev[to].tasks];
      const overIdx = toTasks.findIndex((t) => t._id === overId);
      const insertAt = overIdx === -1 ? toTasks.length : overIdx;
      toTasks.splice(insertAt, 0, moving);
      return prev.map((column, i) => {
        if (i === from) return { ...column, tasks: fromTasks };
        if (i === to) return { ...column, tasks: toTasks };
        return column;
      });
    });
  }

  // ESC などでドラッグがキャンセルされたとき、handleDragOver でのローカル
  // 移動を破棄して server の真実へ戻す。ドラッグ中は購読同期が停止している
  // （上記 useEffect が activeTask で早期 return）ため、columns はドラッグ
  // 開始前のスナップショットであり復元元として正しい。
  function handleDragCancel() {
    setActiveTask(null);
    if (columns) {
      syncedRef.current = columns;
      setBoard(toLocal(columns));
    }
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
        // 同一列内の並べ替え。over が列コンテナ（overIndex === -1）なら末尾へ
        // フォールバックし、位置が変わらないなら何もしない。
        const targetIndex = resolveSameColumnTargetIndex(
          oldIndex,
          overIndex,
          columnTasks.length,
        );
        if (targetIndex === null) return;
        columnTasks = arrayMove(columnTasks, oldIndex, targetIndex);
        setBoard((prev) =>
          prev === null
            ? prev
            : prev.map((c, i) =>
                i === toCol ? { ...c, tasks: columnTasks } : c,
              ),
        );
        const { before, after } = neighborRanks(
          columnTasks.map((t) => t.rank),
          targetIndex,
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
      collisionDetection={collisionDetection}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragStart={handleDragStart}
      sensors={sensors}
    >
      {error !== null && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      {/* タスク皆無でも空列だけが並ぶと次の一手が分からないため案内を出す
          （Issue #29）。列＝droppable は D&D 構造維持のためそのまま描画する。 */}
      {boardIsEmpty && (
        <p className={s.empty}>
          タスクがありません。Issue 一覧の「＋ タスク」または「＋ 新規
          Issue」から作成できます。
        </p>
      )}
      {/* ドラッグ中は列またぎの再マウントでカードの出現フェード（card-in）が
          再生されチラつくため、コンテナ単位でアニメーションを抑止する（#79） */}
      <div className={`${s.board} ${activeTask ? s.boardDragging : ""}`}>
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
          <div className={s.overlay}>
            <TaskCard
              assigneeName={activeTask.assigneeName}
              issueNumber={activeTask.issueNumber}
              projectKey={projectKey}
              task={activeTask}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
