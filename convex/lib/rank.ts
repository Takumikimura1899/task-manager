import { generateKeyBetween } from "fractional-indexing";

/**
 * カンバン並び順（OrderedRank, 基本設計書 §3）の生成。
 *
 * fractional-indexing をラップした純粋関数。rank は同一の (project, status)
 * 列内で比較可能な文字列で、昇順がボード上の上→下に対応する。
 * 2タスクの「間」に新しい rank を割り当てられるため、隣接タスクの rank を
 * 書き換えずに D&D 並べ替え（任意順への挿入）を実現できる。
 */

/**
 * before と after の間の rank を生成する。
 * - null は端を表す（before=null → 先頭、after=null → 末尾）。
 * - before < after でなければならない。
 *
 * 注意: fractional-indexing は引数の順序を検証せず、before >= after でも
 * 矛盾した値を返す（並べ替えを静かに破壊する）。そのため、ここで前段に
 * ガードを置き、不正な範囲は例外で明示的に失敗させる。
 */
export function rankBetween(
  before: string | null,
  after: string | null,
): string {
  if (before !== null && after !== null && before >= after) {
    throw new Error(
      `rankBetween: before (${before}) は after (${after}) より小さい必要があります`,
    );
  }
  return generateKeyBetween(before, after);
}
