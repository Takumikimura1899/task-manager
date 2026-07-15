import type { Doc } from "../../convex/_generated/dataModel";
import type { FilterState } from "./filterParams";
import type { TaskStatus } from "./taskMeta";

/**
 * カンバンD&Dの純粋ロジック（DB・React非依存・テスト容易）。
 *
 * 並べ替え後の列（rank昇順を維持したタスク列）における、移動カードの
 * 挿入位置から tasks.move へ渡す before / after の近傍 rank を導く。
 */

/**
 * board クエリが返す Task。表示用に所属 Issue 番号と担当者名を付与した形。
 * （DnD ロジックは Doc<"tasks"> 由来の rank/_id/status のみ使う）
 */
export type BoardTask = Doc<"tasks"> & {
  issueNumber: number | null;
  assigneeName: string | null;
};

/** Board のローカル編集可能な列。status 別6列を維持する（Board.tsx と共有）。 */
export type BoardColumn = { status: TaskStatus; tasks: BoardTask[] };

/**
 * priority/assignee でカードを絞り込む（Issue #92）。列構造（status）は保持し、
 * 各列の tasks だけを絞る。両方 null（フィルタ無し）なら入力をそのまま返す。
 *
 * Board 側は toLocal で複製した列をこの関数に通してから setBoard するため、
 * ここでは非破壊（列・タスク配列を新規に作る）を前提にせず、フィルタ無し時は
 * 素通しでよい。
 */
export function applyBoardFilter(
  columns: BoardColumn[],
  filter: FilterState,
): BoardColumn[] {
  if (filter.priority === null && filter.assignee === null) return columns;
  return columns.map((column) => ({
    status: column.status,
    tasks: column.tasks.filter(
      (t) =>
        (filter.priority === null || t.priority === filter.priority) &&
        (filter.assignee === null || t.assignee === filter.assignee),
    ),
  }));
}

/**
 * 並べ替え後の rank 配列と移動カードの index から、その上下の近傍 rank を返す。
 * - `orderedRanks` は移動カード自身を含む最終的な並び（昇順）。
 * - 先頭なら before=null、末尾なら after=null。
 *
 * 返り値は tasks.move の before/after にそのまま渡せる（before < after を満たす）。
 *
 * 注意: フィルタ適用中の board（可視カードのみ）にこの関数を直接使うと、
 * 可視カードの間に隠れたカードがいる場合に rank が重複しうる
 * （neighborRanksInFullColumn を参照）。フィルタ非対応の呼び出し元・
 * 単体テストでのみ使うこと。
 */
export function neighborRanks(
  orderedRanks: readonly string[],
  movedIndex: number,
): { before: string | null; after: string | null } {
  return {
    before: movedIndex > 0 ? orderedRanks[movedIndex - 1] : null,
    after:
      movedIndex < orderedRanks.length - 1
        ? orderedRanks[movedIndex + 1]
        : null,
  };
}

/**
 * ドロップ位置の可視アンカー（直前/直後の可視カード）から、フル列順における
 * 実際の隣接 rank ペアを求める。可視隣接だけで計算すると、間に隠れたカードと
 * 同一 rank を重複発行しうる（rankBetween は決定的）ため、必ず「フル列で
 * 本当に隣接している2枚の間」を返す。
 * - visiblePrev があれば「visiblePrev の直後」に挿入（before=visiblePrev.rank、
 *   after=フル列で visiblePrev の次のカードの rank）
 * - visiblePrev が無く visibleNext があれば「visibleNext の直前」に挿入
 *   （after=visibleNext.rank、before=フル列で visibleNext の前のカードの rank）
 * - どちらも無ければフル列の末尾へ（before=フル列末尾の rank、after=undefined）
 * fullColumn にドラッグ中カードが含まれる場合は除外して計算する。
 */
export function neighborRanksInFullColumn(
  fullColumn: readonly BoardTask[],
  draggedId: string,
  visiblePrev: BoardTask | null,
  visibleNext: BoardTask | null,
): { before: string | undefined; after: string | undefined } {
  const others = fullColumn.filter((t) => t._id !== draggedId);

  if (visiblePrev) {
    const prevIndex = others.findIndex((t) => t._id === visiblePrev._id);
    const next = prevIndex === -1 ? undefined : others[prevIndex + 1];
    return { before: visiblePrev.rank, after: next?.rank };
  }

  if (visibleNext) {
    const nextIndex = others.findIndex((t) => t._id === visibleNext._id);
    const prev = nextIndex <= 0 ? undefined : others[nextIndex - 1];
    return { before: prev?.rank, after: visibleNext.rank };
  }

  const last = others[others.length - 1];
  return { before: last?.rank, after: undefined };
}

/**
 * 同一列内ドロップの移動先 index を解決する。
 * - `overIndex === -1`（over がタスクではなく列コンテナ＝空きスペースやヘッダー付近）は
 *   列をまたぐ D&D と同様に「末尾へ移動」としてフォールバックする。
 * - 移動しても位置が変わらない場合、または移動元が見つからない場合は null（no-op）。
 */
export function resolveSameColumnTargetIndex(
  oldIndex: number,
  overIndex: number,
  taskCount: number,
): number | null {
  if (oldIndex === -1) return null;
  const target = overIndex === -1 ? taskCount - 1 : overIndex;
  return target === oldIndex ? null : target;
}

/**
 * 複数段階の衝突検出結果から「カード」を「列コンテナ」より優先して選ぶ。
 *
 * over が列コンテナに解決されると同一列ドロップは末尾へフォールバックする
 * （resolveSameColumnTargetIndex）ため、いずれかの段階でカードに当たっていれば
 * 必ずカード側を over にする。列 body は列の全高を占めており、ポインタが盤面内に
 * ある限り先頭段階（pointerWithin）は列を返す——そこで打ち切らず後続段階から
 * カードを探すことで、カード間の隙間へのドロップが「末尾へ移動」と誤判定される
 * のを防ぐ。どの段階にもカードが無ければ、最初に衝突があった段階の結果
 * （列コンテナ＝本当に余白へのドロップ）を返す。
 */
export function pickCardFirstCollisions<T extends { id: string | number }>(
  stages: readonly (readonly T[])[],
  columnIds: ReadonlySet<string>,
): T[] {
  for (const stage of stages) {
    const cards = stage.filter((c) => !columnIds.has(String(c.id)));
    if (cards.length > 0) return cards;
  }
  const fallback = stages.find((stage) => stage.length > 0);
  return fallback ? [...fallback] : [];
}

/**
 * ポインタのいる列にスコープしたカード優先の衝突解決。
 *
 * ドラッグハンドルはカードの右上にあるため、ポインタが隣の列に入っても
 * ドラッグ中のカード矩形（rectIntersection の対象）は元の列に大きく残る。
 * カード優先を全列に適用すると rectIntersection が拾った**元の列のカード**に
 * over が吸われ、列またぎのドロップが同一列の並べ替えに誤変換される（#65）。
 *
 * そこでカード優先の候補を「ポインタのいる列に属するカード」に限定する:
 * - ポインタがカード上: そのカードを返す（最優先・列によらず一意）
 * - ポインタが列内の余白・隙間: rectIntersection のカードのうち
 *   その列に属するものだけを候補にし（カード間の隙間 #53 の挙動を維持）、
 *   無ければ列コンテナを返す（末尾フォールバック #14 の挙動を維持）
 * - ポインタ情報が無い（KeyboardSensor 等で pointerWithin が空）: null を返し、
 *   呼び出し元が従来のフォールバックへ委ねる
 */
export function pickPointerScopedCollisions<T extends { id: string | number }>(
  pointerHits: readonly T[],
  rectHits: readonly T[],
  columnIds: ReadonlySet<string>,
  columnOfCard: (cardId: string) => string | null,
): T[] | null {
  const pointerCards = pointerHits.filter((c) => !columnIds.has(String(c.id)));
  if (pointerCards.length > 0) return pointerCards;

  const pointerColumn = pointerHits.find((c) => columnIds.has(String(c.id)));
  if (!pointerColumn) return null;

  const cardsInPointerColumn = rectHits.filter(
    (c) =>
      !columnIds.has(String(c.id)) &&
      columnOfCard(String(c.id)) === String(pointerColumn.id),
  );
  return cardsInPointerColumn.length > 0
    ? cardsInPointerColumn
    : [pointerColumn];
}
