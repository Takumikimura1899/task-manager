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
  applyBoardFilter,
  type BoardColumn,
  type BoardTask,
  neighborRanksInFullColumn,
  pickCardFirstCollisions,
  pickPointerScopedCollisions,
  resolveSameColumnTargetIndex,
} from "../../lib/board";
import {
  EMPTY_FILTER,
  type FilterState,
  useFilterParams,
} from "../../lib/filterParams";
import { TASK_STATUS_LABELS, TASK_STATUS_ORDER } from "../../lib/taskMeta";
import { FilterClearButton } from "../FilterBar/FilterClearButton";
import { Skeleton } from "../Skeleton/Skeleton";
import { TaskCard } from "../TaskCard/TaskCard";
import s from "./Board.module.css";
import { Column } from "./Column";

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

/** mutation 反映待ち中に開始されたドラッグを拒否したときの案内。 */
const DRAG_LOCKED_MESSAGE =
  "直前の操作を反映しています。少し待ってからもう一度お試しください";

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
  const [filter, setFilter] = useFilterParams();

  const [board, setBoard] = useState<BoardColumn[] | null>(null);
  const [activeTask, setActiveTask] = useState<BoardTask | null>(null);
  const [error, setError] = useState<string | null>(null);

  // onDragEnd から最新の board を参照するための ref。
  const boardRef = useRef<BoardColumn[] | null>(null);
  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  // server から新しいスナップショット or フィルタ変更があったときだけ同期する
  // （ドラッグ中は維持）。activeTask が null に戻っただけでは再同期しない
  // （楽観更新のちらつき防止）。フィルタは parseFilterParams が useMemo
  // されているため URL 不変なら同一参照を保つ（useFilterParams 参照）。
  const syncedRef = useRef<readonly BoardColumn[] | undefined>(undefined);
  const appliedFilterRef = useRef<FilterState | undefined>(undefined);
  // handleDragEnd の moveTask/transitionStatus が未解決の間にインクリメントする
  // カウンタ（Issue #92）。await 中にフィルタが変わると、この効果が
  // 「columns 不変・filter 変化」で発火し、ドロップ前の古い snapshot から
  // board を再構築して楽観更新を巻き戻してしまうため、mutation 解決前は
  // 同期を止める。mutation 成功後は新しい columns snapshot が届いた時点で
  // （columnsChanged=true になり）最新 filter がまとめて適用される。
  const pendingMutationsRef = useRef(0);
  // mutation 未解決中は SortableTaskCard の useSortable を disabled にし、
  // dnd-kit 自身にドラッグを開始させない（Issue #92 4周目レビュー指摘1・2）。
  // 以前は Board の React state（activeTask）だけを抑止する方式だったが、
  // それでは dnd-kit 内部のドラッグライフサイクル（transform 追従・
  // DragOverlay 無しでのポインタ追従、ドロップ時の汎用エラー残留）を止め
  // られず、見た目が壊れたまま操作できてしまっていた。ドラッグの発生源
  // （dnd-kit の useSortable）側で止めることで、in-flight mutation を常に
  // 高々1つに保ち、(1) neighborRanksInFullColumn へ渡す fullColumn（columns
  // スナップショット）が新しいドラッグの間に stale化する、(2) handleDragCancel
  // が進行中の楽観更新を巻き戻す、(3) catch の resyncFromServer が別ドラッグを
  // clobber する、も合わせて防ぐ。
  const [dragLocked, setDragLocked] = useState(false);
  // dragLocked（state）が useSortable の disabled に反映されるのは再レンダー後の
  // ため、反映前のごく短い競合ウィンドウでは dnd-kit がドラッグを開始できて
  // しまう。その「activeTask を持たない幽霊ドラッグ」が handleDragOver で
  // ローカル board を書き換えないよう、開始時に印を付けて over/end/cancel を
  // 一貫して無効化するバックストップ（Issue #92 5周目レビュー指摘）。
  const lockedDragRef = useRef(false);

  /** syncedRef/appliedFilterRef を更新しつつ、server snapshot から board を再構築する。 */
  const resyncFromServer = useCallback(
    (cols: readonly BoardColumn[]) => {
      syncedRef.current = cols;
      appliedFilterRef.current = filter;
      setBoard(applyBoardFilter(toLocal(cols), filter));
    },
    [filter],
  );

  useEffect(() => {
    if (activeTask) return;
    if (columns === undefined) return;
    const columnsChanged = syncedRef.current !== columns;
    if (!columnsChanged && pendingMutationsRef.current > 0) return;
    if (!columnsChanged && appliedFilterRef.current === filter) return;
    resyncFromServer(columns);
  }, [columns, activeTask, filter, resyncFromServer]);

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
  // server snapshot（未フィルタ）自体が0件かどうか。フィルタで全滅した場合と
  // 区別し、本当に0件のプロジェクトでは常に作成導線を出す（Issue #92）。
  // board の派生元スナップショット（syncedRef.current）から計算する。pending
  // 中は live な columns だけが進んでも board は据え置かれるため、ここも
  // board と同じスナップショットを基準にしないと表示メッセージと表示中
  // カードが矛盾しうる（再レビュー指摘3）。board !== null の時点では
  // syncedRef.current は必ず設定済み（resyncFromServer が setBoard に先行
  // して同期的にセットするため）。
  const serverIsEmpty = (syncedRef.current ?? []).every(
    (column) => column.tasks.length === 0,
  );

  function findTask(id: string): BoardTask | null {
    for (const column of boardRef.current ?? []) {
      const found = column.tasks.find((t) => t._id === id);
      if (found) return found;
    }
    return null;
  }

  function handleDragStart({ active }: DragStartEvent) {
    // dragLocked（useSortable の disabled）が効いていれば dnd-kit がそもそも
    // ドラッグを開始しないため通常は到達しない。disabled 反映前のごく短い
    // 競合ウィンドウで開始された幽霊ドラッグは、activeTask を設定せず
    // lockedDragRef で over/end/cancel まで一貫して無効化する。
    if (pendingMutationsRef.current > 0) {
      lockedDragRef.current = true;
      return;
    }
    setError(null);
    setActiveTask(findTask(active.id as string));
  }

  // ドラッグ中、別の列に重なったらローカル状態上でカードを移し替える。
  function handleDragOver({ active, over }: DragOverEvent) {
    if (lockedDragRef.current) return;
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
    // 幽霊ドラッグ（lockedDragRef）はローカル変更を作っていないため、
    // 印を下ろすだけで resync も不要。
    if (lockedDragRef.current) {
      lockedDragRef.current = false;
      return;
    }
    setActiveTask(null);
    // mutation 未解決中は resync しない。dragLocked により通常のドラッグは
    // pendingMutationsRef が 0 のとき（前回の mutation が完了済み）にしか
    // 開始されないため、この時点でも 0 のはずだが、念のためガードする。
    if (columns && pendingMutationsRef.current === 0) resyncFromServer(columns);
  }

  // rank 不変条件（Issue #92）: board はフィルタ適用後（可視カードのみ）の配列
  // のため、可視カードの前後だけから rank を発行すると、間に隠れたカードと
  // 同一 rank を重複発行しうる（rankBetween は決定的関数のため、同じ
  // before/after からは常に同じ rank が生成される。重複すると rank 昇順の
  // board クエリの順序が不定になり、後続の rankBetween(x, x) は例外を投げる）。
  // そのため neighborRanksInFullColumn で「フル列（未フィルタの server
  // snapshot）における可視アンカーの直近実隣接」を求め、その間へ挿入する。
  // 挿入位置は常にフル列で本当に隣接する2枚の間になるため、rank は一意になる。
  async function handleDragEnd({ active, over }: DragEndEvent) {
    // 幽霊ドラッグのドロップは黙って捨てず、拒否した理由をユーザーへ伝える
    // （サイレント失敗の回避）。ただし案内を出すのはドロップ時点でまだ
    // mutation が未解決のときだけ。既に解決済みなら (1) 成功時: ロックは
    // 解除済みで即座に再試行できるため案内は不要（出すと以後クリアされず
    // 残留する）、(2) 失敗時: catch が表示した本当のエラーを誤った案内で
    // 上書きしてはならない。
    if (lockedDragRef.current) {
      lockedDragRef.current = false;
      if (pendingMutationsRef.current > 0) setError(DRAG_LOCKED_MESSAGE);
      return;
    }
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
    const fullColumn =
      columns?.find((c) => c.status === targetStatus)?.tasks ?? [];

    try {
      let mutationPromise: Promise<unknown>;

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
        const { before, after } = neighborRanksInFullColumn(
          fullColumn,
          dragged._id,
          columnTasks[targetIndex - 1] ?? null,
          columnTasks[targetIndex + 1] ?? null,
        );
        mutationPromise = moveTask({
          id: dragged._id,
          before: before ?? null,
          after: after ?? null,
          expectedRevision: dragged.revision,
        });
      } else {
        // 列をまたぐ移動は状態遷移（状態機械で検証）。
        // handleDragOver でカードは既に遷移先列のドロップ位置へ配置済みなので、
        // その近傍 rank を渡して末尾固定ではなく任意位置へ挿入する。
        const movedIndex = columnTasks.findIndex((t) => t._id === activeId);
        const { before, after } = neighborRanksInFullColumn(
          fullColumn,
          dragged._id,
          columnTasks[movedIndex - 1] ?? null,
          columnTasks[movedIndex + 1] ?? null,
        );
        mutationPromise = transitionStatus({
          id: dragged._id,
          to: targetStatus,
          before,
          after,
          expectedRevision: dragged.revision,
        });
      }

      // mutation 未解決の間は同期 effect による resync を止め、かつ
      // dragLocked で新しいドラッグの開始自体を防ぐ（Issue #92）。
      // 参照は resyncFromServer / dragLocked 側の解説を参照。
      pendingMutationsRef.current++;
      setDragLocked(true);
      try {
        await mutationPromise;
      } finally {
        pendingMutationsRef.current--;
        if (pendingMutationsRef.current === 0) setDragLocked(false);
      }
      // 反映待ちを理由に拒否した幽霊ドラッグの案内は、当の mutation が
      // 成功した時点で用済みなので残さない（失敗時は catch が上書きする）。
      setError((prev) => (prev === DRAG_LOCKED_MESSAGE ? null : prev));
    } catch (e) {
      setError(errorMessage(e));
      // 失敗時は server の真実へ戻す。
      if (columns) resyncFromServer(columns);
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
          （Issue #29）。列＝droppable は D&D 構造維持のためそのまま描画する。
          server snapshot 自体が0件（プロジェクトに本当にタスクが無い）なら
          フィルタの有無を問わず作成導線を出す。server には既にタスクがあり
          フィルタで全件隠れた場合のみクリア導線を出す（Issue #92）。 */}
      {serverIsEmpty && (
        <p className={s.empty}>
          タスクがありません。Issue 一覧の「＋ タスク」または「＋ 新規
          Issue」から作成できます。
        </p>
      )}
      {!serverIsEmpty && boardIsEmpty && (
        <p className={s.empty}>
          フィルタに一致するタスクがありません。
          <FilterClearButton
            onClick={() => setFilter(EMPTY_FILTER)}
            variant="inline"
          >
            フィルタをクリア
          </FilterClearButton>
        </p>
      )}
      {/* ドラッグ中は列またぎの再マウントでカードの出現フェード（card-in）が
          再生されチラつくため、コンテナ単位でアニメーションを抑止する（#79） */}
      <div className={`${s.board} ${activeTask ? s.boardDragging : ""}`}>
        {board.map((column) => (
          <Column
            dragLocked={dragLocked}
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
