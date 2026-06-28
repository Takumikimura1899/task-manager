import { describe, expect, it } from "vitest";
import { neighborRanks } from "./board";

/**
 * カンバン並べ替えの近傍rank算出（純粋関数）の振る舞いを検証する。
 * tasks.move は before < after を要求するため、境界での null と
 * 隣接要素の正しい選択を確認する。
 */
describe("neighborRanks", () => {
  const ranks = ["a", "m", "z"];

  it.each([
    // [movedIndex, before, after]
    [0, null, "m"], // 先頭へ移動 → 上端、下は次要素
    [1, "a", "z"], // 中間へ移動 → 上下とも隣接要素
    [2, "m", null], // 末尾へ移動 → 下端、上は前要素
  ])("index=%i のとき before/after を返す", (index, before, after) => {
    expect(neighborRanks(ranks, index)).toEqual({ before, after });
  });

  it("要素が1つだけの列では上下とも端(null)になる", () => {
    expect(neighborRanks(["a"], 0)).toEqual({ before: null, after: null });
  });
});
