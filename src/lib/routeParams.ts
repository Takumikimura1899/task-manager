/**
 * ルートパラメータの参照番号を厳密な正の整数として解釈する。
 * Number() は "1e3" や " 5 " 等も数値化してしまうため、正規化された表現
 * （先頭ゼロなしの桁のみ）だけを許可し、別タスクの誤表示（例: /tasks/1e3 →
 * #1000、/tasks/007 → #7。Issue #16）を防ぐ。不正なら null を返す。
 */
export function parseRefNumber(value: string | undefined): number | null {
  if (value === undefined || !/^[1-9]\d*$/.test(value)) return null;
  return Number(value);
}
