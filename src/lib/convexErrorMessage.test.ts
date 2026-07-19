import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { convexErrorMessage } from "./convexErrorMessage";

/**
 * Convex ミューテーション失敗からユーザー向けメッセージを抽出する純粋関数の
 * 仕様を固定する。useCreateForm/useEditForm/useDeleteFlow で共有するため、
 * ここでの振る舞い固定が3箇所の実装ドリフトを防ぐ（Issue #104 レビュー対応）。
 */
describe("convexErrorMessage", () => {
  it("ConvexError は data をそのままメッセージとして返す", () => {
    expect(
      convexErrorMessage(new ConvexError("タイトルは必須です"), "失敗しました"),
    ).toBe("タイトルは必須です");
  });

  it.each([
    ["ConvexError 以外の例外", new Error("network down")],
    ["例外以外の値", "network down"],
    ["null", null],
    ["undefined", undefined],
  ])("%s は fallback を返す", (_case, thrown) => {
    expect(convexErrorMessage(thrown, "失敗しました")).toBe("失敗しました");
  });
});
