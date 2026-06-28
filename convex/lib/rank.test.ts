import { describe, expect, it } from "vitest";
import { rankBetween } from "./rank";

/**
 * 並び順キー生成（純粋関数）の振る舞いを検証する。
 * 生成される具体的な値はライブラリ依存のため、値そのものではなく
 * 「順序関係（大小比較）」で検証し、リファクタリング耐性を確保する。
 */
describe("rankBetween", () => {
  it("最初の1件は空でない文字列を返す", () => {
    const r = rankBetween(null, null);
    expect(typeof r).toBe("string");
    expect(r.length).toBeGreaterThan(0);
  });

  it("末尾追加は直前の rank より大きい", () => {
    const first = rankBetween(null, null);
    const appended = rankBetween(first, null);
    expect(appended > first).toBe(true);
  });

  it("先頭追加は直後の rank より小さい", () => {
    const first = rankBetween(null, null);
    const prepended = rankBetween(null, first);
    expect(prepended < first).toBe(true);
  });

  it("間への挿入は両端の rank の間に収まる", () => {
    const a = rankBetween(null, null);
    const c = rankBetween(a, null);
    const b = rankBetween(a, c);
    expect(a < b).toBe(true);
    expect(b < c).toBe(true);
  });

  it("同じ隙間へ繰り返し挿入しても昇順が保たれる", () => {
    // [low, high] の間に毎回先頭側へ挿入し続け、列全体の昇順を検証する
    const low = rankBetween(null, null);
    const high = rankBetween(low, null);
    const inserted: string[] = [];
    let upper = high;
    for (let i = 0; i < 20; i++) {
      const next = rankBetween(low, upper);
      inserted.push(next);
      upper = next;
    }
    // 挿入は降順に生成されるので、列全体は low < ...reverse(inserted)... < high
    const ordered = [low, ...[...inserted].reverse(), high];
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i - 1] < ordered[i]).toBe(true);
    }
  });

  it("before >= after の不正な範囲は例外を投げる", () => {
    const a = rankBetween(null, null);
    const b = rankBetween(a, null); // b > a
    expect(() => rankBetween(b, a)).toThrow();
  });
});
