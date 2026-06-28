/**
 * カンバンD&Dの純粋ロジック（DB・React非依存・テスト容易）。
 *
 * 並べ替え後の列（rank昇順を維持したタスク列）における、移動カードの
 * 挿入位置から tasks.move へ渡す before / after の近傍 rank を導く。
 */

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
