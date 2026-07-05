import { describe, expect, it } from "vitest";
import {
  neighborRanks,
  prioritizeCardCollisions,
  resolveSameColumnTargetIndex,
} from "./board";

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

/**
 * 同一列内ドロップの移動先解決を検証する。
 * over が列コンテナ（overIndex === -1）のときは末尾へフォールバックし、
 * 位置が変わらないドロップは null（no-op）になることを確認する。
 */
describe("resolveSameColumnTargetIndex", () => {
  it.each([
    // [ケース, oldIndex, overIndex, taskCount, expected]
    ["タスク上へのドロップは overIndex へ移動", 0, 2, 3, 2],
    ["列コンテナへのドロップは末尾へフォールバック", 0, -1, 3, 2],
    ["同じ位置へのドロップは no-op", 1, 1, 3, null],
    ["末尾タスクを列コンテナに落とすと no-op（既に末尾）", 2, -1, 3, null],
    ["要素が1つの列で列コンテナに落とすと no-op", 0, -1, 1, null],
    ["移動元が見つからない場合は no-op", -1, -1, 3, null],
  ])("%s", (_case, oldIndex, overIndex, taskCount, expected) => {
    expect(resolveSameColumnTargetIndex(oldIndex, overIndex, taskCount)).toBe(
      expected,
    );
  });
});

/**
 * 衝突検出のカード優先絞り込みを検証する。
 * over が列コンテナに解決されると末尾フォールバックが誤発動するため、
 * カードと列が同時に衝突している間はカードだけが over 候補に残ることを確認する。
 */
describe("prioritizeCardCollisions", () => {
  const columnIds: ReadonlySet<string> = new Set(["backlog", "todo"]);

  it.each([
    // [ケース, 入力の衝突id列, 期待する出力id列]
    [
      "カードと列が混在したらカードのみ残す",
      ["backlog", "task1", "task2"],
      ["task1", "task2"],
    ],
    ["カードのみはそのまま", ["task1"], ["task1"]],
    ["列のみはそのまま（余白へのドロップ）", ["backlog"], ["backlog"]],
    ["空はそのまま", [], []],
  ])("%s", (_case, ids, expected) => {
    const collisions = ids.map((id) => ({ id }));
    expect(prioritizeCardCollisions(collisions, columnIds)).toEqual(
      expected.map((id) => ({ id })),
    );
  });
});
