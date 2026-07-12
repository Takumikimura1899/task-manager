import { describe, expect, it } from "vitest";
import { formatHours, formatHoursTotal } from "./formatHours";

/**
 * 工数の表示整形（純粋関数）の仕様を固定する。
 * 二進浮動小数点の加算誤差（1.1 + 2.2 → 3.3000000000000003 等）を
 * 小数第2位への丸めで吸収し、末尾に "h" を付けた文字列を返す。
 */
describe("formatHours", () => {
  it.each([
    [1.1 + 2.2, "3.3h"], // 加算誤差 3.3000000000000003 を丸めて吸収
    [8, "8h"], // 整数はそのまま
    [0.5, "0.5h"], // 小数第1位はそのまま
    [0.1 + 0.2, "0.3h"], // 別の加算誤差パターン（0.30000000000000004）
    [0, "0h"], // 0 の丸め表示自体はこの関数の責務（「—」分岐は呼び出し側）
  ])("formatHours(%j) は %j を返す", (input, expected) => {
    expect(formatHours(input)).toBe(expected);
  });
});

/**
 * 合計工数の表示整形の仕様を固定する。バックエンドは 0.001 等の極小値も
 * 許容するため、丸めた結果が 0 になる値（未入力の 0 と区別が付かない）は
 * 一律 "—" にする。丸めて 0 にならない値は formatHours と同じ結果になる。
 */
describe("formatHoursTotal", () => {
  it.each([
    [0, "—"], // 未入力（合計 0）
    [0.004, "—"], // 丸めると 0 になる極小値も未入力扱いに統一する
    [0.005, "0.01h"], // 丸めて 0 にならない最小域の境界値
    [1.1 + 2.2, "3.3h"], // 加算誤差 3.3000000000000003 を丸めて吸収
  ])("formatHoursTotal(%j) は %j を返す", (input, expected) => {
    expect(formatHoursTotal(input)).toBe(expected);
  });
});
