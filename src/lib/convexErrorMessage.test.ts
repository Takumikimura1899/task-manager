import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DisplayableError,
  convexErrorMessage,
  reportConvexError,
} from "./convexErrorMessage";

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

/**
 * convexErrorMessage に加え、想定外の例外だけを console.error に残す
 * reportConvexError（監査 H-1）の分岐を固定する。
 */
describe("reportConvexError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ConvexError でも DisplayableError でもない例外は console.error に記録し、fallback を返す", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const thrown = new Error("network down");

    expect(reportConvexError(thrown, "失敗しました")).toBe("失敗しました");
    expect(spy).toHaveBeenCalledWith(thrown);
  });

  it("ConvexError は console.error を呼ばず data をメッセージとして返す", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(
      reportConvexError(new ConvexError("タイトルは必須です"), "失敗しました"),
    ).toBe("タイトルは必須です");
    expect(spy).not.toHaveBeenCalled();
  });

  it("DisplayableError は console.error を呼ばずそのメッセージを返す", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(
      reportConvexError(new DisplayableError("必須項目です"), "失敗しました"),
    ).toBe("必須項目です");
    expect(spy).not.toHaveBeenCalled();
  });
});
