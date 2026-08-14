/**
 * パスワードの最小要件（基本設計書 §8）。convex/auth.ts（Password provider の
 * validatePasswordRequirements）・convex/seed.ts（demoAuth）・
 * src/routes/SignIn/SignIn.tsx（minLength 属性）の3箇所が同じ「8文字以上」を
 * 個別にハードコードしていたため、定数と判定ロジックをここへ一元化する。
 * 例外の投げ方（Error / ConvexError / UI 属性）は呼び出し側の文脈で異なるため
 * 各呼び出し元に委ね、ここでは判定のみを提供する（convex/lib/validators.ts の
 * isValidHours などと同じ「述語を共有し、投げ方は呼び出し元」という設計）。
 */

export const MIN_PASSWORD_LENGTH = 8;

export function isPasswordLengthValid(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH;
}
