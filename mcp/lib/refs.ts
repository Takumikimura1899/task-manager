/**
 * MCP サーバーの純粋ロジック（基本設計書 §6）。
 *
 * Convex や MCP SDK に依存しない参照解析・アクティブ判定をここに切り出し、
 * main.ts は Convex 関数との結線（I/O）に徹する。切り出した関数は
 * ユニットテスト（refs.test.ts）で振る舞いを検証する。
 */
import type { IssueStatus } from "../../convex/lib/issueStatus";
import type { TaskStatus } from "../../convex/lib/taskStatus";

const TASK_REF_PATTERN = /^([A-Z]+)-(\d+)$/;

/** "TASK-123" 形式のタスク参照を {key, number} に分解する。 */
export function parseTaskRef(ref: string): { key: string; number: number } {
  const m = TASK_REF_PATTERN.exec(ref.trim());
  if (m === null) {
    throw new Error(`タスク参照の形式が不正です: "${ref}"（例: TASK-123）`);
  }
  return { key: m[1], number: Number(m[2]) };
}

const ISSUE_REF_PATTERN = /^([A-Z]+)#(\d+)$/;

/** "TASK#1" 形式の Issue 参照を {key, number} に分解する。 */
export function parseIssueRef(ref: string): { key: string; number: number } {
  const m = ISSUE_REF_PATTERN.exec(ref.trim());
  if (m === null) {
    throw new Error(`Issue 参照の形式が不正です: "${ref}"（例: TASK#1）`);
  }
  return { key: m[1], number: Number(m[2]) };
}

/**
 * done / canceled 以外を「アクティブ」とみなす（Task / Issue 共通）。
 * `project://{key}` のアクティブ Issue 一覧や `task://{key}/mine` の
 * 未完了タスク絞り込みに用いる。
 */
export function isActiveStatus(status: TaskStatus | IssueStatus): boolean {
  return status !== "done" && status !== "canceled";
}
