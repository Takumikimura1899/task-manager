import { act, renderHook } from "@testing-library/react";
import { ConvexError } from "convex/values";
import type { FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { useEditForm } from "./useEditForm";

/**
 * 詳細画面共通の編集モードフックの振る舞い（開閉・下書き更新・保存と
 * 成功時のクローズ・楽観ロック競合の検出）を検証する。save（ミューテーション）は
 * 外部依存のためモックする。
 */

type Draft = { title: string; description: string };

const initialDraft: Draft = { title: "元のタイトル", description: "元の説明" };

const createSave = (impl: () => Promise<void> = async () => {}) =>
  vi.fn<(draft: Draft) => Promise<void>>(impl);

const createSubmitEvent = () =>
  ({ preventDefault: vi.fn<() => void>() }) as unknown as FormEvent;

describe("useEditForm", () => {
  it("初期状態は閲覧モードで、open で編集モードに入り close で破棄する", () => {
    const { result } = renderHook(() => useEditForm({ save: createSave() }));

    expect(result.current.editing).toBe(false);
    expect(result.current.draft).toBeNull();

    act(() => result.current.open(initialDraft));
    expect(result.current.editing).toBe(true);
    expect(result.current.draft).toEqual(initialDraft);

    act(() => result.current.close());
    expect(result.current.editing).toBe(false);
    expect(result.current.draft).toBeNull();
  });

  it("update は下書きの指定フィールドだけを差し替える", () => {
    const { result } = renderHook(() => useEditForm({ save: createSave() }));

    act(() => result.current.open(initialDraft));
    act(() => result.current.update({ title: "新タイトル" }));

    expect(result.current.draft).toEqual({
      title: "新タイトル",
      description: "元の説明",
    });
  });

  it("submit 成功時は下書きを save に渡して閲覧モードへ戻る", async () => {
    const save = createSave();
    const { result } = renderHook(() => useEditForm({ save }));

    act(() => result.current.open(initialDraft));
    await act(() => result.current.submit(createSubmitEvent()));

    expect(save).toHaveBeenCalledWith(initialDraft);
    expect(result.current.editing).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("閲覧モードでの submit は save を呼ばない", async () => {
    const save = createSave();
    const { result } = renderHook(() => useEditForm({ save }));

    await act(() => result.current.submit(createSubmitEvent()));

    expect(save).not.toHaveBeenCalled();
  });

  it("楽観ロック競合（ConvexError の競合メッセージ）は conflict として編集モードを維持する", async () => {
    const message =
      "競合が発生しました。他の更新があったため最新を取得してください。";
    const save = createSave(async () => {
      throw new ConvexError(message);
    });
    const { result } = renderHook(() => useEditForm({ save }));

    act(() => result.current.open(initialDraft));
    await act(() => result.current.submit(createSubmitEvent()));

    expect(result.current.editing).toBe(true);
    expect(result.current.error).toBe(message);
    expect(result.current.conflict).toBe(true);
  });

  it.each([
    [
      "競合以外の ConvexError はメッセージをそのまま表示し conflict にしない",
      new ConvexError("タイトルは必須です"),
      "タイトルは必須です",
    ],
    [
      "ConvexError 以外の例外は汎用メッセージを表示する",
      new Error("network down"),
      "保存に失敗しました",
    ],
  ])("%s", async (_case, thrown, expected) => {
    const save = createSave(async () => {
      throw thrown;
    });
    const { result } = renderHook(() => useEditForm({ save }));

    act(() => result.current.open(initialDraft));
    await act(() => result.current.submit(createSubmitEvent()));

    expect(result.current.error).toBe(expected);
    expect(result.current.conflict).toBe(false);
  });

  it("競合後に open し直すとエラーが消え、最新値で編集をやり直せる", async () => {
    const save = createSave(async () => {
      throw new ConvexError("競合が発生しました。");
    });
    const { result } = renderHook(() => useEditForm({ save }));

    act(() => result.current.open(initialDraft));
    await act(() => result.current.submit(createSubmitEvent()));
    expect(result.current.conflict).toBe(true);

    const latest: Draft = { title: "最新タイトル", description: "最新説明" };
    act(() => result.current.open(latest));

    expect(result.current.draft).toEqual(latest);
    expect(result.current.error).toBeNull();
    expect(result.current.conflict).toBe(false);
  });
});
