/**
 * Git アーティファクトからのタスク参照抽出（基本設計書 §5/§7）。
 * 純粋関数・外部依存なし。
 */

export interface TaskRef {
  key: string;
  number: number;
}

// ブランチ名・PR本文用: どこかに KEY-123 を含む（例 feature/TASK-123-foo）
const LOOSE_REF = /([A-Z]+)-(\d+)/;

/** 文字列から最初のタスク参照を抽出する（なければ null）。ブランチ名・PR本文に使う。 */
export function extractTaskRef(text: string): TaskRef | null {
  const m = LOOSE_REF.exec(text);
  return m === null ? null : { key: m[1], number: Number(m[2]) };
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
