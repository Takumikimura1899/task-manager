import { describe, expect, it } from "vitest";
import { parseRefNumber } from "./routeParams";

/**
 * ルートパラメータの参照番号解釈（純粋関数）の仕様を固定する。
 * Number() 直呼びでは "1e3" や " 5 " も数値化され、先頭ゼロ（"007"）も
 * #7 と別解釈されて非正規 URL を通してしまうため、正規化された表現
 * （先頭ゼロなしの桁のみ）だけを許可する（routeParams.ts / Issue #16）。
 */
describe("parseRefNumber", () => {
  it.each([
    ["1", 1],
    ["42", 42],
    ["1000", 1000],
  ])("桁のみの文字列 %j は正の整数 %i として解釈する", (input, expected) => {
    expect(parseRefNumber(input)).toBe(expected);
  });

  it.each([
    ["1e3"], // 指数表記（Number() では 1000 になってしまう）
    [" 5 "], // 前後空白（Number() では 5 になってしまう）
    [""], // 空文字
    ["abc"], // 非数値
    ["-1"], // 符号付き
    ["1.5"], // 小数
    ["007"], // 先頭ゼロ（#7 の非正規表現。Issue #16 で拒否に変更）
    ["0"], // ゼロ（参照番号は 1 始まりの正の整数）
  ])("正規化された正の整数でない %j は null で拒否する", (input) => {
    expect(parseRefNumber(input)).toBeNull();
  });

  it("undefined（パラメータ欠落）は null で拒否する", () => {
    expect(parseRefNumber(undefined)).toBeNull();
  });
});
