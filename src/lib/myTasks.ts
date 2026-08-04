import type { Doc } from "../../convex/_generated/dataModel";
import {
  PRIORITY_WEIGHT,
  TASK_STATUS_ORDER,
  type TaskStatus,
} from "./taskMeta";

/**
 * 「My Tasks」ビューの純粋ロジック（DB・React 非依存・テスト容易）。
 *
 * tasks.listMine が返す Task（表示用に projectKey と親 Issue 番号を付与した形）。
 * src/lib/board.ts の BoardTask と同じ「手動写し」の慣習。
 */
export type MyTask = Doc<"tasks"> & {
  projectKey: string;
  issueNumber: number | null;
};

export type MyTaskSection = { status: TaskStatus; tasks: MyTask[] };

/** グループ内の並び順: 期限日昇順（未設定は末尾）→ 優先度降順 → projectKey → number。 */
function compareMyTasks(a: MyTask, b: MyTask): number {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === undefined) return 1; // 期限日未設定は末尾
    if (b.dueDate === undefined) return -1;
    return a.dueDate < b.dueDate ? -1 : 1; // YYYY-MM-DD は辞書順=時系列順
  }
  const byPriority = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]; // 高い順
  if (byPriority !== 0) return byPriority;
  if (a.projectKey !== b.projectKey)
    return a.projectKey < b.projectKey ? -1 : 1;
  return a.number - b.number;
}

/**
 * 全プロジェクト横断の担当 Task を status 別セクションへグルーピングする。
 * セクション順は TASK_STATUS_ORDER（§5 固定6状態）。空セクションは返さない
 * （0件の見出しだけ並ぶ画面を避けるため）。
 */
export function groupMyTasks(tasks: readonly MyTask[]): MyTaskSection[] {
  return TASK_STATUS_ORDER.flatMap((status) => {
    const inStatus = tasks.filter((t) => t.status === status);
    if (inStatus.length === 0) return [];
    // 購読配列を壊さないよう toSorted() を使う（IssuesView.tsx と同じ理由）。
    return [{ status, tasks: inStatus.toSorted(compareMyTasks) }];
  });
}
