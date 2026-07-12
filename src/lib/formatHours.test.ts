import { describe, expect, it } from "vitest";
import { formatHours } from "./formatHours";

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
