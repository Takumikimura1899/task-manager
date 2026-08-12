import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { applyBoardFilter, type BoardColumn } from "../../lib/board";
import type { FilterState } from "../../lib/filterParams";

/** server スナップショットをローカル編集可能な形へ複製する。 */
function toLocal(columns: readonly BoardColumn[]): BoardColumn[] {
  return columns.map((c) => ({ status: c.status, tasks: [...c.tasks] }));
}

export type BoardSnapshot = {
  board: BoardColumn[] | null;
  setBoard: Dispatch<SetStateAction<BoardColumn[] | null>>;
  /** collisionDetection（deps []）専用。他の参照は board のクロージャを使うこと（L-1）。 */
  boardRef: RefObject<BoardColumn[] | null>;
  /** syncedRef 由来の派生値（board と同一スナップショット基準）。 */
  serverIsEmpty: boolean;
  /** useSortable disabled 用（Column へ渡す）。 */
  dragLocked: boolean;
  /** 同期読み取り（dragStart の幽霊ドラッグ判定・ドロップ拒否メッセージ用）。 */
  mutationInFlight: () => boolean;
  /** 排他 mutation 実行。in-flight ありなら fn を実行せず false（「高々1」の強制点）。 */
  runExclusive: (fn: () => Promise<unknown>) => Promise<boolean>;
  /** 最新 columns から board を再構築する。in-flight 中は no-op（clobber 防止の強制点）。 */
  resyncFromServer: () => void;
};

/**
 * Board 専用フック（H-2）。server 同期 effect と
 * syncedRef/appliedFilterRef/pending/dragLocked/board を1箇所に閉じ、
 * mutation 実行を runExclusive の1経路に集約する。
 *
 * 暗黙の不変条件（前提）: 成功する mutation は必ず board query
 * （api.tasks.board）の結果を変える（revision を無条件 increment する）。
 * runExclusive の finally からの回収（下記 recoverEpoch の専用 effect）は
 * この前提の上に成り立つ——mutation が no-op で columns を変えないと、
 * 新しい snapshot が届かず回収されない。convex 側の move/transitionStatus
 * に no-op short-circuit を入れてはならない。
 */
export function useBoardSnapshot({
  columns,
  filter,
  dragging,
}: {
  columns: readonly BoardColumn[] | undefined;
  filter: FilterState;
  dragging: boolean;
}): BoardSnapshot {
  const [board, setBoard] = useState<BoardColumn[] | null>(null);
  const [dragLocked, setDragLocked] = useState(false);

  // collisionDetection（deps []）専用の最新 board 参照（L-1 を踏襲）。他の
  // 参照は呼び出し元（Board.tsx）側で board のクロージャを直接使うこと。
  // 更新は board 変化後の useEffect で行う（この設計上、render 中代入へ
  // 変えないこと——#65 領域の挙動変更になる。禁止事項）。
  const boardRef = useRef<BoardColumn[] | null>(null);
  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  // 安定 callback（resyncFromServer/runExclusive、いずれも deps 空）から
  // 最新の columns/filter を読むための ref。render 中に直接代入する。
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const filterRef = useRef(filter);
  filterRef.current = filter;

  // server から新しいスナップショット or フィルタ変更があったときだけ同期
  // する（ドラッグ中は維持）。フィルタは parseFilterParams が useMemo
  // されているため URL 不変なら同一参照を保つ（useFilterParams 参照）。
  const syncedRef = useRef<readonly BoardColumn[] | undefined>(undefined);
  const appliedFilterRef = useRef<FilterState | undefined>(undefined);
  // in-flight mutation を「高々1」に保つフラグ。boolean のまま保つこと
  // （state 化しない・下記の主同期 effect の deps に pending や dragLocked
  // 相当を追加しないこと——2026-08-05 の go/no-go 検証で、どちらの変形も
  // 既存テスト全緑のまま実バグ（mutation 解決時の巻き戻り）を生むと実測
  // 済み。再提案しないこと）。boolean で「2以上」は型レベルで表現不能。
  const pendingRef = useRef(false);

  /** syncedRef/appliedFilterRef を更新しつつ、server snapshot から board を再構築する。 */
  const resyncFromServer = useCallback(() => {
    if (pendingRef.current) return; // 不変条件: in-flight 中に resync しない
    const cols = columnsRef.current;
    if (cols === undefined) return;
    syncedRef.current = cols;
    appliedFilterRef.current = filterRef.current;
    setBoard(applyBoardFilter(toLocal(cols), filterRef.current));
  }, []);

  useEffect(() => {
    if (dragging) return;
    if (columns === undefined) return;
    // pending 中は columnsChanged でも同期を全面停止する（H-2）。取りこぼし
    // た snapshot は runExclusive の finally 経由（下記 recoverEpoch の
    // 専用 effect）で回収する。
    if (pendingRef.current) return;
    if (syncedRef.current === columns && appliedFilterRef.current === filter)
      return;
    resyncFromServer();
  }, [columns, dragging, filter, resyncFromServer]);

  const mutationInFlight = useCallback(() => pendingRef.current, []);

  // runExclusive の finally が「pending 中に取りこぼした snapshot」を回収
  // するためのトリガー（epoch）。finally でその場 resync しない
  // （直接 resync すると1フレーム巻き戻る——実測済み。禁止事項）:
  // sync client ストア層の read-your-writes は guaranteed だが、React の
  // render/ref 層は not-guaranteed で、finally 到達時点の columnsRef.current
  // は常に mutation 前 snapshot（setState 再レンダーは await 継続より
  // 後に来るマクロタスクのため）。ここで直接 resync すると、自分の書き込み
  // を含まない snapshot から再構築して1レンダー分の巻き戻りフレームを
  // 生む。epoch state 経由で1レンダー後の専用 effect（下記）へ委譲する
  // ことでこれを避ける。
  const [recoverEpoch, setRecoverEpoch] = useState(0);

  const runExclusive = useCallback(async (fn: () => Promise<unknown>) => {
    if (pendingRef.current) return false; // 排他の唯一の強制点
    pendingRef.current = true;
    setDragLocked(true);
    try {
      await fn();
    } finally {
      pendingRef.current = false;
      setDragLocked(false);
      // setDragLocked と同一バッチになるため追加レンダーは発生しない。
      setRecoverEpoch((e) => e + 1);
    }
    return true;
  }, []);

  // recoverEpoch 専用の回収 effect。columnsChanged 限定（filter 単独変化は
  // 適用しない）。却下済み代替案「dragLocked を主同期 effect の deps に
  // 入れる」との違いはここで、主同期 effect の deps は汚さずこの専用
  // effect だけが古い snapshot と新 filter の混線を避ける。
  useEffect(() => {
    if (recoverEpoch === 0) return;
    // mutation 解決直後の窓で次のドラッグが既に始まっている場合は回収を
    // 見送る（ドラッグ中の board を丸ごと置換するとカードがテレポートする）。
    // 見送った分は、ドラッグ終了時に主同期 effect（deps に dragging を含む）
    // が syncedRef との差分で回収する。
    if (dragging) return;
    if (pendingRef.current) return;
    const cols = columnsRef.current;
    if (cols !== undefined && syncedRef.current !== cols) resyncFromServer();
  }, [recoverEpoch, dragging, resyncFromServer]);

  // board の派生元スナップショット（syncedRef.current）から計算する。pending
  // 中は live な columns だけが進んでも board は据え置かれるため、ここも
  // board と同じスナップショットを基準にしないと表示メッセージと表示中
  // カードが矛盾しうる（Issue #92 再レビュー指摘3）。
  const serverIsEmpty = (syncedRef.current ?? []).every(
    (column) => column.tasks.length === 0,
  );

  return {
    board,
    boardRef,
    dragLocked,
    mutationInFlight,
    resyncFromServer,
    runExclusive,
    serverIsEmpty,
    setBoard,
  };
}
