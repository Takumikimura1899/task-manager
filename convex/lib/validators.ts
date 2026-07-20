import { ConvexError } from "convex/values";

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

/** 見積・実績工数（単位: 時間）: 有限な非負数のみ許容する。 */
export function isValidHours(n: number): boolean {
  return Number.isFinite(n) && n >= 0;
}

/** 招待コードの受理上限。正規トークンは 64 文字（generateInviteToken の hex）。 */
export const MAX_INVITE_CODE_LENGTH = 128;

/**
 * サインアップ時の招待コード引数の検証・取り出し（convex/auth.ts の Password
 * profile() で使用）。上限を超える入力は users doc へ書き込む前に ConvexError で
 * 拒否し、巨大文字列の書き込みによる容量・リソース濫用を防ぐ（どのみち照合には
 * 一致し得ない）。文字列以外（signIn フロー等の未指定含む）は undefined を返す。
 */
export function extractInviteCodeParam(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.length > MAX_INVITE_CODE_LENGTH) {
    throw new ConvexError("招待コードが不正です");
  }
  return value;
}

/**
 * 見積・実績工数フィールドの検証（tasks.updateFields の estimate/actual で共有）。
 * undefined/null（未指定・クリア）は素通しし、数値が isValidHours を満たさない
 * 場合のみ ConvexError で失敗させる。`label` はエラー文言の主語（例: "見積工数"）。
 */
export function assertHours(
  label: string,
  value: number | null | undefined,
): void {
  if (value === undefined || value === null) return;
  if (!isValidHours(value)) {
    throw new ConvexError(`${label}は 0 以上の数値で指定してください`);
  }
}
