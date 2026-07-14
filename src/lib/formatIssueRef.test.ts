import { describe, expect, it } from "vitest";
import { formatIssueRef } from "./formatIssueRef";

/**
 * Issue 参照ラベルの表示整形（純粋関数）の仕様を固定する。
 * `Issue #{number}` 形式は複数コンポーネントで表示を共有するため、
 * ここでの振る舞い固定が表記ドリフト（Issue #89 のレビュー指摘）を防ぐ。
 */
describe("formatIssueRef", () => {
  it.each([
    [12, "Issue #12"], // 通常の番号
    [0, "Issue #0"], // 0 もそのまま埋め込む（未入力扱い等の特別扱いはしない）
    [1000, "Issue #1000"], // 桁数が増えても区切り文字は挿入しない
  ])("formatIssueRef(%j) は %j を返す", (input, expected) => {
    expect(formatIssueRef(input)).toBe(expected);
  });
});
