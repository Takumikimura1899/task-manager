import { describe, expect, it } from "vitest";
import { parseRefNumber } from "./routeParams";

/**
 * ルートパラメータの参照番号解釈（純粋関数）の現行仕様を固定する。
 * Number() 直呼びでは "1e3" や " 5 " も数値化され別タスクの誤表示に
 * つながるため（routeParams.ts:8 の設計意図）、桁のみを許可する。
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
  ])("桁のみでない %j は null で拒否する", (input) => {
    expect(parseRefNumber(input)).toBeNull();
  });

  it("undefined（パラメータ欠落）は null で拒否する", () => {
    expect(parseRefNumber(undefined)).toBeNull();
  });

  // NOTE: 先頭ゼロ（"007" → 7）は現行挙動の記録。Issue #16 で拒否に変更予定。
  it("先頭ゼロは現行挙動では通る（#16 で変更予定）", () => {
    expect(parseRefNumber("007")).toBe(7);
  });
});
