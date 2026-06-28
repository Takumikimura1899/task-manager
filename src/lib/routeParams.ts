/**
 * ルートパラメータの参照番号を厳密な正の整数として解釈する。
 * Number() は "1e3" や " 5 " 等も数値化してしまうため、桁のみを許可して
 * 別タスクの誤表示（例: /tasks/1e3 → #1000）を防ぐ。不正なら null を返す。
 */
export function parseRefNumber(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  return Number(value);
}
