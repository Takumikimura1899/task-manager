/**
 * 入力バリデーション・正規化の純粋関数（基本設計書 §3 不変条件の前段）。
 *
 * DB 非依存。一意性そのものの保証（INVARIANT）は mutation 側で
 * 永続層のトランザクション（Convex の OCC）により行う。ここでは
 * 「保存してよい形か」「比較のための正規形」だけを決める。
 */

/**
 * プロジェクトキー: 大文字英字のみ 2〜10 文字。
 * commit 規約パーサの正規表現 `\[([A-Z]+-\d+)\]`（§5/§7）と整合させ、
 * キー部分を `[A-Z]+` に限定する。
 */
const PROJECT_KEY_PATTERN = /^[A-Z]+$/;

export function isValidProjectKey(key: string): boolean {
  return PROJECT_KEY_PATTERN.test(key) && key.length >= 2 && key.length <= 10;
}

/** email を一意性比較・保存のために正規化する（前後空白除去＋小文字化）。 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** 簡易 email 形式チェック（MVP: 厳密な RFC 準拠は行わない）。 */
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}
