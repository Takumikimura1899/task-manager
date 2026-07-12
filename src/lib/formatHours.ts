/**
 * 工数（時間）を表示用の文字列へ整形する。
 * `estimate ?? 0` の単純合計等は二進浮動小数点の加算誤差を含みうる
 * （例: 1.1 + 2.2 → 3.3000000000000003）。これを小数第2位で丸めて吸収し、
 * `3.3h` のような表示用文字列を返す。バックエンドの集計値自体は丸めない
 * （設計判断）ため、丸めは表示直前のこの関数に一本化する。
 * 0 の扱い（「—」表示等）は呼び出し側の責務であり、この関数には含めない。
 */
export function formatHours(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return `${rounded}h`;
}

/**
 * 合計工数（時間）を表示用の文字列へ整形する。
 * バックエンドは 0.001 のような極小値も許容するため、単純に
 * `formatHours` を通すと丸め後に "0h" となり、未入力（合計 0）を表す
 * "—" と区別が付かない矛盾表示になりうる。そこで合計の表示に限っては、
 * 丸めた結果が 0 になる値は一律「未入力」扱いとして "—" を返す。
 * 個別値の表示（TaskDetail 等）は従来どおり formatHours を使うこと。
 */
export function formatHoursTotal(total: number): string {
  const rounded = Math.round(total * 100) / 100;
  return rounded === 0 ? "—" : formatHours(total);
}
