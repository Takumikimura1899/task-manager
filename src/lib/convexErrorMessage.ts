import { ConvexError, type Value } from "convex/values";

/**
 * サーバーへの往復（Convex ミューテーション）を経ないクライアント側の
 * 検証失敗など、ユーザーにそのまま見せてよいメッセージを表す軽量な
 * エラー型。ConvexError はサーバー（convex 関数）が意図して投げるエラー
 * 専用の型のため、往復前に確定するクライアント検証エラーに型流用しない
 * （TaskDetail の工数・日付バリデーション／監査 L-8）。
 */
export class DisplayableError extends Error {}

/**
 * ユーザーにそのまま見せてよい（表示可能な）エラーかどうかの判定。
 * convexErrorMessage（肯定形分岐）と reportConvexError（否定形ガード）の
 * 両方から使い、判定条件をこの1箇所に集約する。
 */
function isDisplayableError(
  err: unknown,
): err is ConvexError<Value> | DisplayableError {
  return err instanceof ConvexError || err instanceof DisplayableError;
}

/**
 * Convex ミューテーション呼び出しの失敗からユーザー向けメッセージを抽出する。
 * ConvexError（サーバー側が意図して投げたバリデーション/競合エラー等）と
 * DisplayableError（クライアント側の検証エラー等）は data / message を
 * そのままメッセージとして使い、それ以外の予期しない例外は呼び出し元が
 * 指定した汎用メッセージへフォールバックする
 * （useCreateForm/useEditForm/useDeleteFlow/Board/AppLayout/TaskDetail/SignIn
 * で共有・Issue #104）。
 */
export function convexErrorMessage(err: unknown, fallback: string): string {
  if (!isDisplayableError(err)) return fallback;
  return err instanceof ConvexError ? String(err.data) : err.message;
}

/**
 * convexErrorMessage に加え、想定外の例外（ConvexError でも
 * DisplayableError でもないもの＝呼び出し元が意図していないエラー）を
 * console.error に残す唯一の経路。UI へ表示するメッセージの決定とログ
 * 出力を1箇所へ集約し、呼び出し側ごとの流儀のばらつき・ログ漏れ
 * （サイレント失敗）を防ぐ（監査 H-1）。
 */
export function reportConvexError(err: unknown, fallback: string): string {
  if (!isDisplayableError(err)) {
    console.error(err);
  }
  return convexErrorMessage(err, fallback);
}
