import type { Doc } from "../../convex/_generated/dataModel";
import { addDaysIso } from "./gantt";
import { PRIORITY_WEIGHT } from "./taskMeta";

/**
 * 「My Page」タスクセクションの純粋ロジック（DB・React 非依存・テスト容易）。
 *
 * tasks.listMine が返す Task（表示用に projectKey と親 Issue 番号を付与した形）。
 * src/lib/board.ts の BoardTask と同じ「手動写し」の慣習。
 */
export type MyTask = Doc<"tasks"> & {
  projectKey: string;
  issueNumber: number | null;
};

/**
 * 期限軸のグルーピング区分（基本設計書 §2 My Page）。
 * 表示順は DUE_BUCKET_ORDER（期限切れ→今日→今後7日→それ以降→期限なし）。
 */
export type DueBucket = "overdue" | "today" | "next7" | "later" | "noDue";

export type MyTaskDueGroup = { bucket: DueBucket; tasks: MyTask[] };

export const DUE_BUCKET_ORDER: readonly DueBucket[] = [
  "overdue",
  "today",
  "next7",
  "later",
  "noDue",
];

export const DUE_BUCKET_LABELS: Record<DueBucket, string> = {
  overdue: "期限切れ",
  today: "今日",
  next7: "今後7日",
  later: "それ以降",
  noDue: "期限なし",
};

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
 * dueDate と today（いずれも YYYY-MM-DD）から期限バケットを判定する。
 * next7End は today の7日後。today 自身は "today" バケットに属するため、
 * "next7" は today の翌日から next7End までの7日間になる。
 */
function resolveDueBucket(
  dueDate: string | undefined,
  today: string,
  next7End: string,
): DueBucket {
  if (dueDate === undefined) return "noDue";
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "today";
  if (dueDate <= next7End) return "next7";
  return "later";
}

/**
 * 全プロジェクト横断の担当 Task を期限軸でグルーピングする
 * （基本設計書 §2 My Page: 期限切れ→今日→今後7日→それ以降→期限なし）。
 * done/canceled は追う必要がないため表示対象から除く。空グループは返さない
 * （0件の見出しだけ並ぶ画面を避けるため）。
 *
 * today は呼び出し側（コンポーネント。`todayIso()` 由来）が渡す。引数化する
 * ことで「今日」に依存する判定を日付固定でテストできる。
 */
export function groupMyTasksByDueDate(
  tasks: readonly MyTask[],
  today: string,
): MyTaskDueGroup[] {
  const next7End = addDaysIso(today, 7);
  const active = tasks.filter(
    (t) => t.status !== "done" && t.status !== "canceled",
  );

  return DUE_BUCKET_ORDER.flatMap((bucket) => {
    const inBucket = active.filter(
      (t) => resolveDueBucket(t.dueDate, today, next7End) === bucket,
    );
    if (inBucket.length === 0) return [];
    // 購読配列を壊さないよう toSorted() を使う（IssuesView.tsx と同じ理由）。
    return [{ bucket, tasks: inBucket.toSorted(compareMyTasks) }];
  });
}
