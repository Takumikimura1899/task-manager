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
import { useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  type BoardColumn,
  type BoardTask,
  insertAnchor,
  pickCardFirstCollisions,
  pickPointerScopedCollisions,
  resolveSameColumnTargetIndex,
} from "../../lib/board";
import { reportConvexError } from "../../lib/convexErrorMessage";
import type { FilterState } from "../../lib/filterParams";
import { TASK_STATUS_LABELS, TASK_STATUS_ORDER } from "../../lib/taskMeta";
import { FilterClearButton } from "../FilterBar/FilterClearButton";
import { Skeleton } from "../Skeleton/Skeleton";
import { TaskCard } from "../TaskCard/TaskCard";
import s from "./Board.module.css";
import { Column } from "./Column";
import { useBoardSnapshot } from "./useBoardSnapshot";

const COLUMN_IDS: ReadonlySet<string> = new Set(TASK_STATUS_ORDER);

// 衝突検出はポインタのいる列にスコープする必要があるため、
// 列の所属を知る Board コンポーネント内で組み立てる（下記 collisionDetection）。

/** id（タスクid or 列status）が属する列の index を返す。 */
function columnIndexOf(board: BoardColumn[], id: string): number {
  const byStatus = board.findIndex((c) => c.status === id);
  if (byStatus !== -1) return byStatus;
  return board.findIndex((c) => c.tasks.some((t) => t._id === id));
}

/** mutation 反映待ち中に開始されたドラッグを拒否したときの案内。 */
const DRAG_LOCKED_MESSAGE =
  "直前の操作を反映しています。少し待ってからもう一度お試しください";

export function Board({
  project,
  projectKey,
  filter,
  onClearFilter,
}: {
  project: Id<"projects">;
  projectKey: string;
  filter: FilterState;
  onClearFilter: () => void;
}) {
  const columns = useQuery(api.tasks.board, { project });
  const moveTask = useMutation(api.tasks.move);
  const transitionStatus = useMutation(api.tasks.transitionStatus);

  const [activeTask, setActiveTask] = useState<BoardTask | null>(null);
  const [error, setError] = useState<string | null>(null);

  // server 同期 effect と board/boardRef/dragLocked/mutation 実行を1箇所に
  // 閉じる Board 専用フック（H-2）。詳細は useBoardSnapshot.ts のコメント参照。
  const {
    board,
    setBoard,
    boardRef,
    serverIsEmpty,
    dragLocked,
    mutationInFlight,
    runExclusive,
    resyncFromServer,
  } = useBoardSnapshot({
    // null（非参加プロジェクトへのアクセス。ADR-11 projectQuery の型契約）は
    // 下記の early return で別扱いするため、hook へは undefined として渡し
    // 通常のロード中と同じ「同期しない」状態に留める。
    columns: columns ?? undefined,
    filter,
    dragging: activeTask !== null,
  });

  // dragLocked（state）が useSortable の disabled に反映されるのは再レンダー後の
  // ため、反映前のごく短い競合ウィンドウでは dnd-kit がドラッグを開始できて
  // しまう。その「activeTask を持たない幽霊ドラッグ」が handleDragOver で
  // ローカル board を書き換えないよう、開始時に印を付けて over/end/cancel を
  // 一貫して無効化するバックストップ（Issue #92 5周目レビュー指摘）。
  const lockedDragRef = useRef(false);
  // 反例A対策: handleDragOver が列をまたいでローカル board を書き換えた
  // （from !== to が成立した）ことがあるかを記録する。列またぎ→元列復帰の
  // 往復後、handleDragEnd が同一列 no-op（over===active 等）へ落ちると、
  // mutation を呼ばずに早期 return し、その後の同期 effect も発火しない
  // ため、往復で生じたローカル順序のずれが server の真実へ永久に復元
  // されない（既存バグ）。dirty のときだけ、その早期 return の直前で
  // resyncFromServer して復元する。新しいドラッグ開始時（handleDragStart）
  // にリセットする。
  const crossColumnDirtyRef = useRef(false);

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
  const collisionDetection = useCallback<CollisionDetection>(
    (args) => {
      const pointerHits = pointerWithin(args);
      const rectHits = rectIntersection(args);
      const scoped = pickPointerScopedCollisions(
        pointerHits,
        rectHits,
        COLUMN_IDS,
        (cardId) => {
          for (const column of boardRef.current ?? []) {
            if (column.tasks.some((t) => t._id === cardId))
              return column.status;
          }
          return null;
        },
      );
      if (scoped) return scoped;
      const overlapping = pickCardFirstCollisions(rectHits, COLUMN_IDS);
      return overlapping.length > 0 ? overlapping : closestCorners(args);
      // boardRef は useBoardSnapshot 内の useRef 由来で参照が安定している
      // ため、deps に加えても再生成は発生しない（L-1 の deps []
      // 契約は維持される）。
    },
    [boardRef],
  );

  // null は非参加プロジェクトへのアクセス（ADR-11 projectQuery の型契約。
  // 詳細な案内は PR③ で整備し、PR② では最低限のガードに留める）。
  if (columns === null) {
    return <p className={s.empty}>プロジェクトが見つかりません。</p>;
  }

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
  // serverIsEmpty は useBoardSnapshot が board と同一スナップショット
  // （syncedRef.current）基準で算出したもの（再レビュー指摘3）。

  // L-1: board のクロージャを直接使う（アロー関数として、board === null の
  // 早期 return の後に定義する——巻き上げられる function 宣言だと、上の
  // 早期 return による narrowing がボディへ伝播しない。boardRef ではなく
  // ここで board を直接参照するのは、ref の更新が useEffect 経由で1レンダー
  // 遅れうるため、同一レンダー内の最新値を確実に掴むため）。
  const findTask = (id: string): BoardTask | null => {
    for (const column of board) {
      const found = column.tasks.find((t) => t._id === id);
      if (found) return found;
    }
    return null;
  };

  function handleDragStart({ active }: DragStartEvent) {
    // dragLocked（useSortable の disabled）が効いていれば dnd-kit がそもそも
    // ドラッグを開始しないため通常は到達しない。disabled 反映前のごく短い
    // 競合ウィンドウで開始された幽霊ドラッグは、activeTask を設定せず
    // lockedDragRef で over/end/cancel まで一貫して無効化する。
    if (mutationInFlight()) {
      lockedDragRef.current = true;
      return;
    }
    crossColumnDirtyRef.current = false;
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

      // 列またぎの局所適用が実際に発生した（反例A対策・上記コメント参照）。
      crossColumnDirtyRef.current = true;

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
  // 移動を破棄して server の真実へ戻す。ドラッグ中は useBoardSnapshot の
  // 同期 effect が dragging（activeTask !== null）で早期 return し購読同期を
  // 止めているため、resyncFromServer() が使う columns はドラッグ開始前の
  // スナップショットであり復元元として正しい。
  function handleDragCancel() {
    // 幽霊ドラッグ（lockedDragRef）はローカル変更を作っていないため、
    // 印を下ろすだけで resync も不要。
    if (lockedDragRef.current) {
      lockedDragRef.current = false;
      return;
    }
    setActiveTask(null);
    // mutation 未解決中は resync しない（hook 内の pending ガードに委ねる。
    // dragLocked により通常のドラッグは mutation 完了済みのときにしか
    // 開始されないため、この時点でも pending ではないはずだが、念のため
    // ガードは hook 側に残る）。
    resyncFromServer();
  }

  // rank 不変条件（Issue #92）: board はフィルタ適用後（可視カードのみ）の配列
  // のため、可視カードの前後だけからクライアントが rank 文字列を計算すると、
  // 間に隠れたカードと同一 rank を重複発行しうる。この解決はサーバー側
  // （convex/tasks.ts の rankForInsert）がトランザクション内で対象列を
  // フルで読み直して行うため、ここではドロップ位置の可視アンカー（直前/直後の
  // 可視カード）から position（アンカー taskId）を求めて渡すだけでよい。
  // L-1: findTask 同様、board のクロージャを直接使うアロー関数として
  // board === null の早期 return の後に定義する（narrowing 伝播のため）。
  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    // 幽霊ドラッグのドロップは黙って捨てず、拒否した理由をユーザーへ伝える
    // （サイレント失敗の回避）。ただし案内を出すのはドロップ時点でまだ
    // mutation が未解決のときだけ。既に解決済みなら (1) 成功時: ロックは
    // 解除済みで即座に再試行できるため案内は不要（出すと以後クリアされず
    // 残留する）、(2) 失敗時: catch が表示した本当のエラーを誤った案内で
    // 上書きしてはならない。
    if (lockedDragRef.current) {
      lockedDragRef.current = false;
      if (mutationInFlight()) setError(DRAG_LOCKED_MESSAGE);
      return;
    }
    const dragged = activeTask;
    setActiveTask(null);
    if (!over || !dragged) {
      // 反例A対策: 列またぎ dragOver で一度でも局所適用していれば、盤面外
      // ドロップ（over: null）等でこのまま return すると mutation も resync
      // も走らず、ローカル board が server の真実と恒久的に desync する。
      if (crossColumnDirtyRef.current) resyncFromServer();
      return; // L-1: boardRef.current → board closure
    }

    const activeId = active.id as string;
    const overId = over.id as string;
    const toCol = columnIndexOf(board, overId);
    if (toCol === -1) {
      // 反例A対策（上記 !over || !dragged 分岐と同様）。
      if (crossColumnDirtyRef.current) resyncFromServer();
      return;
    }

    const targetStatus = board[toCol].status;
    const columnTasks = board[toCol].tasks;
    const oldIndex = columnTasks.findIndex((t) => t._id === activeId);
    const overIndex = columnTasks.findIndex((t) => t._id === overId);

    try {
      let run: () => Promise<unknown>;

      if (targetStatus === dragged.status) {
        // 同一列内の並べ替え。over が列コンテナ（overIndex === -1）なら末尾へ
        // フォールバックし、位置が変わらないなら何もしない。
        const targetIndex = resolveSameColumnTargetIndex(
          oldIndex,
          overIndex,
          columnTasks.length,
        );
        if (targetIndex === null) {
          // 反例A対策: 列またぎ dragOver で一度でも局所適用していれば、この
          // 同一列 no-op（over===active 等）は mutation を呼ばないため、
          // このまま return するとローカル board が server の真実と
          // 恒久的に desync する（往復で生じた並び順のずれが残る）。
          if (crossColumnDirtyRef.current) resyncFromServer();
          return;
        }
        const nextTasks = arrayMove(columnTasks, oldIndex, targetIndex);
        const position = insertAnchor(
          nextTasks[targetIndex - 1] ?? null,
          nextTasks[targetIndex + 1] ?? null,
        );
        // targetIndex !== oldIndex（resolveSameColumnTargetIndex が null を
        // 返さなかった）ということは、同一列に少なくとももう1枚タスクが
        // あるため、insertAnchor は必ずアンカーを返す（tasks.move の
        // position は必須）。undefined になることは実際には無い到達不能分岐。
        // L-2: この確定を setBoard（run の中）より前に置き、position が
        // undefined のときに楽観更新だけ適用して mutation を呼ばない矛盾
        // 状態を防ぐ。
        if (position === undefined) {
          // 反例A対策（上記 targetIndex === null 分岐と同様）。
          if (crossColumnDirtyRef.current) resyncFromServer();
          return;
        }
        run = () => {
          // fn は async にしない: 排他確認（runExclusive）→ 楽観更新→
          // mutation 開始を1つの同期ステップとして原子化することが、
          // ドロップ即時反映という UX の根拠になっている
          // （frontend-specialist 検証・実装条件3）。
          setBoard((prev) =>
            prev === null
              ? prev
              : prev.map((c, i) =>
                  i === toCol ? { ...c, tasks: nextTasks } : c,
                ),
          );
          return moveTask({
            id: dragged._id,
            position,
            expectedRevision: dragged.revision,
          });
        };
      } else {
        // 列をまたぐ移動は状態遷移（状態機械で検証）。
        // handleDragOver でカードは既に遷移先列のドロップ位置へ配置済みなので、
        // そのアンカーを渡して末尾固定ではなく任意位置へ挿入する（ローカル
        // board は既に更新済みのため、run の中で setBoard する必要はない）。
        const movedIndex = columnTasks.findIndex((t) => t._id === activeId);
        const position = insertAnchor(
          columnTasks[movedIndex - 1] ?? null,
          columnTasks[movedIndex + 1] ?? null,
        );
        run = () =>
          transitionStatus({
            id: dragged._id,
            to: targetStatus,
            position,
            expectedRevision: dragged.revision,
          });
      }

      const ran = await runExclusive(run);
      if (!ran) {
        // busy（in-flight あり）: 列またぎ楽観更新はローカルに残ったまま
        // で、ここから resyncFromServer() を呼んでも pending ガードで効か
        // ない。回収は in-flight 側の finally（epoch 経由の専用 effect）
        // に委ねる。D&D 経路では dnd-kit の activeRef により二重ドロップは
        // 到達不能（dragLocked/lockedDragRef で防止済み）——backstop。
        setError(DRAG_LOCKED_MESSAGE);
        return;
      }
      // 反映待ちを理由に拒否した幽霊ドラッグの案内は、当の mutation が
      // 成功した時点で用済みなので残さない（失敗時は catch が上書きする）。
      setError((prev) => (prev === DRAG_LOCKED_MESSAGE ? null : prev));
    } catch (e) {
      setError(
        reportConvexError(
          e,
          "操作に失敗しました。ページを再読み込みしてください。",
        ),
      );
      // 失敗時は server の真実へ戻す。
      resyncFromServer();
    }
  };

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
          フィルタで全件隠れた場合のみクリア導線を出す（Issue #92）。
          Board 画面自体には作成導線が無いため、Issue 一覧（/issues）への
          誘導リンクを案内する（Issue #106）。インラインの Issue 作成フォームは
          置かない——D&D の in-flight mutation 中に別経路の mutation が
          columns を書き換えると楽観更新が巻き戻る race があるため
          （UI文言・配置規約.md §5）。文中リンクの色・下線・hover・遷移は
          utilities の .inline-link（FilterBar のクリア導線と共有する単一
          ソース）、前の文言との間隔は s.emptyLink で組み合わせる。 */}
      {serverIsEmpty && (
        <p className={s.empty}>
          Task がありません。Issue 一覧から Issue を作成してください。
          <Link className={`inline-link ${s.emptyLink}`} to="/issues">
            Issue 一覧へ
          </Link>
        </p>
      )}
      {!serverIsEmpty && boardIsEmpty && (
        <p className={s.empty}>
          フィルタに一致するタスクがありません。
          <FilterClearButton onClick={onClearFilter} variant="inline">
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
