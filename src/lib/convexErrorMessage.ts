import { ConvexError } from "convex/values";

/**
 * Convex ミューテーション呼び出しの失敗からユーザー向けメッセージを抽出する。
 * ConvexError（サーバー側が意図して投げたバリデーション/競合エラー等）は
 * data をそのままメッセージとして使い、それ以外の予期しない例外は
 * 呼び出し元が指定した汎用メッセージへフォールバックする
 * （useCreateForm/useEditForm/useDeleteFlow で共有・Issue #104）。
 */
export function convexErrorMessage(err: unknown, fallback: string): string {
  return err instanceof ConvexError ? String(err.data) : fallback;
}
