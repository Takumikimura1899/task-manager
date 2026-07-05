/**
 * Git アーティファクトからのタスク参照抽出（基本設計書 §5/§7）。
 * 純粋関数・外部依存なし。
 */

export interface TaskRef {
  key: string;
  number: number;
}

// ブランチ名・PR本文用: 区切られた位置にある KEY-123（例 feature/TASK-123-foo）。
// 前後が英数字に隣接するもの（`UTF-8` 内の `TF-8`、`xTASK-123`、`TASK-123abc` 等）は
// 参照とみなさない。`/`・`-`・`_`・空白・行頭行末・和文文字は区切りとして許容する。
const LOOSE_REF = /(?<![A-Za-z0-9])([A-Z]+)-(\d+)(?![A-Za-z0-9])/g;

/**
 * 文字列から最初のタスク参照を抽出する（なければ null）。ブランチ名・PR本文に使う。
 *
 * `UTF-8`・`COVID-19`・`RFC-2119` のような KEY-番号 形の一般的な文字列は語形だけでは
 * 参照と区別できないため、projectKey で対象プロジェクトのキーに一致する参照だけに
 * 絞り込める（webhooks の findTask 照合と同じ基準を抽出段階に前倒しする）。
 * projectKey を渡した場合、キーの一致しない参照はスキップして次の候補を探す。
 */
export function extractTaskRef(
  text: string,
  projectKey?: string,
): TaskRef | null {
  for (const m of text.matchAll(LOOSE_REF)) {
    if (projectKey === undefined || m[1] === projectKey) {
      return { key: m[1], number: Number(m[2]) };
    }
  }
  return null;
}

// commit メッセージ用: [KEY-123]（§5 規約 \[([A-Z]+-\d+)\]）
const COMMIT_REF = /\[([A-Z]+)-(\d+)\]/g;

/** commit メッセージから全タスク参照を重複排除して抽出する。 */
export function extractTaskRefsFromCommit(message: string): TaskRef[] {
  const seen = new Set<string>();
  const refs: TaskRef[] = [];
  for (const m of message.matchAll(COMMIT_REF)) {
    const id = `${m[1]}-${m[2]}`;
    if (!seen.has(id)) {
      seen.add(id);
      refs.push({ key: m[1], number: Number(m[2]) });
    }
  }
  return refs;
}
