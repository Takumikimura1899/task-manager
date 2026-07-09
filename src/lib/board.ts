import type { Doc } from "../../convex/_generated/dataModel";

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

/**
 * 並べ替え後の rank 配列と移動カードの index から、その上下の近傍 rank を返す。
 * - `orderedRanks` は移動カード自身を含む最終的な並び（昇順）。
 * - 先頭なら before=null、末尾なら after=null。
 *
 * 返り値は tasks.move の before/after にそのまま渡せる（before < after を満たす）。
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
