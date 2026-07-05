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
 * 衝突検出の結果から「カード」を「列コンテナ」より優先して絞り込む。
 *
 * over が列コンテナに解決されると同一列ドロップは末尾へフォールバックする
 * （resolveSameColumnTargetIndex）ため、カードに重なっている間は必ずカード側を
 * over にし、列が over になるのは本当にカードのない余白へ落とすときだけに限る。
 * カードの衝突が無い場合は入力をそのまま返す（列・空いずれも）。
 */
export function prioritizeCardCollisions<T extends { id: string | number }>(
  collisions: readonly T[],
  columnIds: ReadonlySet<string>,
): T[] {
  const cards = collisions.filter((c) => !columnIds.has(String(c.id)));
  return cards.length > 0 ? cards : [...collisions];
}
