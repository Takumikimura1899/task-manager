import { ConvexError } from "convex/values";

/**
 * サーバーへの往復（Convex ミューテーション）を経ないクライアント側の
 * 検証失敗など、ユーザーにそのまま見せてよいメッセージを表す軽量な
 * エラー型。ConvexError はサーバー（convex 関数）が意図して投げるエラー
 * 専用の型のため、往復前に確定するクライアント検証エラーに型流用しない
 * （TaskDetail の工数・日付バリデーション／監査 L-8）。
 */
export class DisplayableError extends Error {}

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
  if (err instanceof ConvexError) return String(err.data);
  if (err instanceof DisplayableError) return err.message;
  return fallback;
}

/**
 * convexErrorMessage に加え、想定外の例外（ConvexError でも
 * DisplayableError でもないもの＝呼び出し元が意図していないエラー）を
 * console.error に残す唯一の経路。UI へ表示するメッセージの決定とログ
 * 出力を1箇所へ集約し、呼び出し側ごとの流儀のばらつき・ログ漏れ
 * （サイレント失敗）を防ぐ（監査 H-1）。
 */
export function reportConvexError(err: unknown, fallback: string): string {
  if (!(err instanceof ConvexError) && !(err instanceof DisplayableError)) {
    console.error(err);
  }
  return convexErrorMessage(err, fallback);
}
