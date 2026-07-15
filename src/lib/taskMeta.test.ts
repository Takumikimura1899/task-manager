import { describe, expect, it } from "vitest";
import {
  PRIORITY_LABELS,
  PRIORITY_OPTIONS,
  PRIORITY_WEIGHT,
  TASK_STATUS_LABELS,
  TASK_STATUS_ORDER,
} from "./taskMeta";

/**
 * タスクメタ定義（表示ラベル・列順）の振る舞いを固定する。
 * PRIORITY_LABELS は PRIORITY_OPTIONS からの派生（単一定義）なので、
 * 導出結果が期待するマッピングそのものであることを検証する。
 */
describe("PRIORITY_LABELS", () => {
  it("PRIORITY_OPTIONS から全優先度の値→ラベルを導出する", () => {
    expect(PRIORITY_LABELS).toEqual({
      none: "なし",
      low: "低",
      medium: "中",
      high: "高",
      urgent: "緊急",
    });
  });

  it("選択肢の全 value に対応するラベルを持つ（欠落なし）", () => {
    for (const option of PRIORITY_OPTIONS) {
      expect(PRIORITY_LABELS[option.value]).toBe(option.label);
    }
  });
});

describe("PRIORITY_WEIGHT", () => {
  it("none < low < medium < high < urgent の昇順になる（#93 のソートで文字列比較を避けるため）", () => {
    expect(PRIORITY_WEIGHT.none).toBeLessThan(PRIORITY_WEIGHT.low);
    expect(PRIORITY_WEIGHT.low).toBeLessThan(PRIORITY_WEIGHT.medium);
    expect(PRIORITY_WEIGHT.medium).toBeLessThan(PRIORITY_WEIGHT.high);
    expect(PRIORITY_WEIGHT.high).toBeLessThan(PRIORITY_WEIGHT.urgent);
  });

  it("PRIORITY_OPTIONS の全 value に対応する重みを持つ（欠落なし）", () => {
    for (const option of PRIORITY_OPTIONS) {
      expect(typeof PRIORITY_WEIGHT[option.value]).toBe("number");
    }
  });
});

describe("TASK_STATUS_ORDER", () => {
  it("§5 固定6状態を重複なく列順どおりに並べる", () => {
    expect(TASK_STATUS_ORDER).toEqual([
      "backlog",
      "todo",
      "in_progress",
      "in_review",
      "done",
      "canceled",
    ]);
    expect(new Set(TASK_STATUS_ORDER).size).toBe(TASK_STATUS_ORDER.length);
  });

  it("全状態が表示ラベルを持つ（列とラベルのドリフト防止）", () => {
    expect(TASK_STATUS_ORDER.toSorted()).toEqual(
      Object.keys(TASK_STATUS_LABELS).toSorted(),
    );
  });
});
