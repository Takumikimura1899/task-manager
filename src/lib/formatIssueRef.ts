/**
 * Issue 番号を画面表示用のラベルへ整形する（`Issue #12` 形式）。
 * `{key}#{number}` の正準参照（MCP・コミットメッセージ等の外部参照）とは別物で、
 * あくまで UI 上の表示ラベル生成に用途を限定する。
 */
export function formatIssueRef(number: number): string {
  return `Issue #${number}`;
}
