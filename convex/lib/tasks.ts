import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * project 配下の Task を一括で読み、所属 Issue ごとにグルーピングして返す。
 * Issue ごとに by_issue を引く N+1 を避けるための一括読み（非境界の .collect()）。
 *
 * - Task を1つも持たない Issue のキーは作らない（呼び出し側は `?? []` で受ける）
 * - グループ内の順序は by_project の読み出し順を保つ
 *   （issues.list の assignees・tasks.gantt の tasks の並びに現れる）
 * - issues.listInProgress（D&D の書き込みごとに再計算されるホットパス）が
 *   共有するため、ここに join や追加の読み取りを足さないこと
 */
export async function loadTasksByIssue(
  ctx: QueryCtx,
  project: Id<"projects">,
): Promise<Map<Id<"issues">, Doc<"tasks">[]>> {
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_project", (q) => q.eq("project", project))
    .collect();

  const byIssue = new Map<Id<"issues">, Doc<"tasks">[]>();
  for (const task of tasks) {
    const group = byIssue.get(task.issue);
    if (group === undefined) {
      byIssue.set(task.issue, [task]);
    } else {
      group.push(task);
    }
  }
  return byIssue;
}
