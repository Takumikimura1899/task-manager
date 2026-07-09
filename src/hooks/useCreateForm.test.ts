import { act, renderHook } from "@testing-library/react";
import { ConvexError } from "convex/values";
import type { FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { useCreateForm } from "./useCreateForm";

/**
 * 作成フォーム共通フックの振る舞い（開閉・入力バリデーション・送信と
 * 成功時のリセット・エラー表示）を検証する。onSubmit（ミューテーション）は
 * 外部依存のためモックする。
 */

type CreateFormOptions = Parameters<typeof useCreateForm>[0];

const createOptions = (
  overrides: Partial<CreateFormOptions> = {},
): CreateFormOptions => ({
  onSubmit: vi.fn<CreateFormOptions["onSubmit"]>(async () => {}),
  submitErrorMessage: "作成に失敗しました",
  ...overrides,
});

const createSubmitEvent = () =>
  ({ preventDefault: vi.fn<() => void>() }) as unknown as FormEvent;

describe("useCreateForm", () => {
  it("初期状態ではクローズ・空入力で送信できない", () => {
    const { result } = renderHook(() => useCreateForm(createOptions()));

    expect(result.current.open).toBe(false);
    expect(result.current.title).toBe("");
    expect(result.current.priority).toBe("none");
    expect(result.current.assignee).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.submitting).toBe(false);
    expect(result.current.canSubmit).toBe(false);
  });

  it.each([
    ["バグを直す", true],
    ["   ", false],
    ["", false],
  ])("title=%j のとき canSubmit=%s になる", (title, expected) => {
    const { result } = renderHook(() => useCreateForm(createOptions()));

    act(() => result.current.setTitle(title));

    expect(result.current.canSubmit).toBe(expected);
  });

  it("extraValid が false の間は送信できない", () => {
    const { result } = renderHook(() =>
      useCreateForm(createOptions({ extraValid: false })),
    );

    act(() => result.current.setTitle("バグを直す"));

    expect(result.current.canSubmit).toBe(false);
  });

  it("送信不可の状態では handleSubmit しても onSubmit を呼ばない", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useCreateForm(options));

    await act(() => result.current.handleSubmit(createSubmitEvent()));

    expect(options.onSubmit).not.toHaveBeenCalled();
  });

  it("送信成功時は trim 済みの入力値で onSubmit を呼び、フォームを閉じてリセットする", async () => {
    const onReset = vi.fn<() => void>();
    const options = createOptions({ onReset });
    const { result } = renderHook(() => useCreateForm(options));

    act(() => {
      result.current.setOpen(true);
      result.current.setTitle("  バグを直す  ");
      result.current.setPriority("high");
      result.current.setAssignee("member_1" as Id<"members">);
    });
    await act(() => result.current.handleSubmit(createSubmitEvent()));

    expect(options.onSubmit).toHaveBeenCalledExactlyOnceWith({
      title: "バグを直す",
      priority: "high",
      assignee: "member_1",
    });
    expect(result.current.open).toBe(false);
    expect(result.current.title).toBe("");
    expect(result.current.priority).toBe("none");
    expect(result.current.assignee).toBeNull();
    expect(result.current.error).toBeNull();
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("送信中は再送信できない", async () => {
    let resolveSubmit = () => {};
    const options = createOptions({
      onSubmit: vi.fn<CreateFormOptions["onSubmit"]>(
        () =>
          new Promise<void>((resolve) => {
            resolveSubmit = resolve;
          }),
      ),
    });
    const { result } = renderHook(() => useCreateForm(options));

    act(() => {
      result.current.setOpen(true);
      result.current.setTitle("バグを直す");
    });
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.handleSubmit(createSubmitEvent());
    });

    expect(result.current.submitting).toBe(true);
    expect(result.current.canSubmit).toBe(false);

    await act(async () => {
      resolveSubmit();
      await pending;
    });

    expect(result.current.submitting).toBe(false);
  });

  it("ConvexError のときはエラー内容を表示し、フォームは開いたまま入力を保持する", async () => {
    const options = createOptions({
      onSubmit: vi.fn<CreateFormOptions["onSubmit"]>(async () => {
        throw new ConvexError("タイトルが重複しています");
      }),
    });
    const { result } = renderHook(() => useCreateForm(options));

    act(() => {
      result.current.setOpen(true);
      result.current.setTitle("バグを直す");
    });
    await act(() => result.current.handleSubmit(createSubmitEvent()));

    expect(result.current.error).toBe("タイトルが重複しています");
    expect(result.current.open).toBe(true);
    expect(result.current.title).toBe("バグを直す");
    expect(result.current.submitting).toBe(false);
  });

  it("ConvexError 以外のエラーのときは既定のメッセージを表示する", async () => {
    const options = createOptions({
      onSubmit: vi.fn<CreateFormOptions["onSubmit"]>(async () => {
        throw new Error("network error");
      }),
      submitErrorMessage: "追加に失敗しました",
    });
    const { result } = renderHook(() => useCreateForm(options));

    act(() => {
      result.current.setOpen(true);
      result.current.setTitle("バグを直す");
    });
    await act(() => result.current.handleSubmit(createSubmitEvent()));

    expect(result.current.error).toBe("追加に失敗しました");
  });

  it("close するとフォームを閉じて全入力とエラーをリセットし onReset を呼ぶ", async () => {
    const onReset = vi.fn<() => void>();
    const options = createOptions({
      onReset,
      onSubmit: vi.fn<CreateFormOptions["onSubmit"]>(async () => {
        throw new ConvexError("失敗");
      }),
    });
    const { result } = renderHook(() => useCreateForm(options));

    act(() => {
      result.current.setOpen(true);
      result.current.setTitle("バグを直す");
      result.current.setPriority("low");
    });
    await act(() => result.current.handleSubmit(createSubmitEvent()));
    act(() => result.current.close());

    expect(result.current.open).toBe(false);
    expect(result.current.title).toBe("");
    expect(result.current.priority).toBe("none");
    expect(result.current.error).toBeNull();
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
