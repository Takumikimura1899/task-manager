import { act, renderHook } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { describe, expect, it, vi } from "vitest";
import { useDeleteFlow } from "./useDeleteFlow";

/**
 * 詳細画面共通の削除確認フックの振る舞い（開閉・確定・number スコープ・
 * number 変更時のリセット）を検証する。remove（ミューテーション）は
 * 外部依存のためモックする。
 *
 * 確定前にパネルを閉じると busy/error の唯一の表示先（ConfirmPanel）が
 * アンマウントされ失敗がサイレントになるため（Issue #104 レビュー指摘）、
 * 「失敗時は confirming を維持する」ことを本フックの中核の振る舞いとして
 * 検証する。
 */

const createRemove = (impl: () => Promise<void> = async () => {}) =>
  vi.fn<() => Promise<void>>(impl);

describe("useDeleteFlow", () => {
  it("初期状態は非表示で、request で確認パネルを開き cancel で閉じる", () => {
    const { result } = renderHook(() =>
      useDeleteFlow({
        number: 1,
        remove: createRemove(),
        onDeleted: vi.fn<() => void>(),
      }),
    );

    expect(result.current.confirming).toBe(false);

    act(() => result.current.request());
    expect(result.current.confirming).toBe(true);

    act(() => result.current.cancel());
    expect(result.current.confirming).toBe(false);
  });

  it("confirm 成功時は remove を呼び、表示中の number が一致すれば onDeleted を呼ぶ", async () => {
    const remove = createRemove();
    const onDeleted = vi.fn<() => void>();
    const { result } = renderHook(() =>
      useDeleteFlow({ number: 1, remove, onDeleted }),
    );

    act(() => result.current.request());
    await act(() => Promise.resolve(result.current.confirm()));

    expect(remove).toHaveBeenCalledTimes(1);
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it("confirm 失敗時は confirming を維持したままエラーを表示し、busy を解除する（サイレント失敗の回避）", async () => {
    const remove = createRemove(async () => {
      throw new ConvexError("Issue の最後の Task は削除できません");
    });
    const onDeleted = vi.fn<() => void>();
    const { result } = renderHook(() =>
      useDeleteFlow({ number: 1, remove, onDeleted }),
    );

    act(() => result.current.request());
    await act(() => Promise.resolve(result.current.confirm()));

    // パネルは開いたまま（アンマウントされていない）でエラーが表示される。
    expect(result.current.confirming).toBe(true);
    expect(result.current.error).toBe("Issue の最後の Task は削除できません");
    expect(result.current.busy).toBe(false);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("ConvexError 以外の例外は汎用メッセージを表示する", async () => {
    const remove = createRemove(async () => {
      throw new Error("network down");
    });
    const { result } = renderHook(() =>
      useDeleteFlow({ number: 1, remove, onDeleted: vi.fn<() => void>() }),
    );

    act(() => result.current.request());
    await act(() => Promise.resolve(result.current.confirm()));

    expect(result.current.error).toBe("削除に失敗しました");
  });

  it("confirm 実行中（busy）の再 confirm 呼び出しは remove を再実行しない（二重実行防止）", async () => {
    let resolveRemove: (() => void) | undefined;
    const remove = createRemove(
      () =>
        new Promise<void>((resolve) => {
          resolveRemove = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useDeleteFlow({ number: 1, remove, onDeleted: vi.fn<() => void>() }),
    );

    act(() => result.current.request());
    act(() => result.current.confirm());
    expect(result.current.busy).toBe(true);

    act(() => result.current.confirm());
    expect(remove).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRemove?.();
      await Promise.resolve();
    });
  });

  it("削除完了時点で表示中の number が削除対象と異なる場合は onDeleted を呼ばず busy だけ解除する（in-flight 中の client-side 遷移）", async () => {
    let resolveRemove: (() => void) | undefined;
    const remove = createRemove(
      () =>
        new Promise<void>((resolve) => {
          resolveRemove = resolve;
        }),
    );
    const onDeleted = vi.fn<() => void>();
    const { result, rerender } = renderHook(
      ({ number }) => useDeleteFlow({ number, remove, onDeleted }),
      { initialProps: { number: 1 } },
    );

    act(() => result.current.request());
    act(() => result.current.confirm());
    expect(result.current.busy).toBe(true);

    // 削除 in-flight のまま、表示中の number が別の値へ切り替わる
    // （同一マウントのまま別エンティティへ client-side 遷移した状況）。
    rerender({ number: 2 });

    await act(async () => {
      resolveRemove?.();
      await Promise.resolve();
    });

    expect(onDeleted).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
  });

  it("number が変わると確認パネルの開閉状態とエラーをリセットする", async () => {
    const remove = createRemove(async () => {
      throw new ConvexError("削除に失敗しました");
    });
    const { result, rerender } = renderHook(
      ({ number }) =>
        useDeleteFlow({ number, remove, onDeleted: vi.fn<() => void>() }),
      { initialProps: { number: 1 } },
    );

    act(() => result.current.request());
    await act(() => Promise.resolve(result.current.confirm()));
    expect(result.current.confirming).toBe(true);
    expect(result.current.error).not.toBeNull();

    rerender({ number: 2 });

    expect(result.current.confirming).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
