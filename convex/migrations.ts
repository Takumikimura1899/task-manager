import { internalMutation } from "./_generated/server";
import { TASK_STATUSES } from "./lib/taskStatus";
import { rankBetween } from "./lib/rank";

/**
 * 既存データの修復用ワンオフ migration（rank 重複バグ修正）。
 *
 * 以前の move/transitionStatus は「可視カードの隣接 rank 文字列」をクライアント
 * から受け取っており、フィルタで隠れたカードの間へ挿入すると隠れたカードと
 * 同一 rank を発行しうる不具合があった（rankForInsert 導入で解消済み・convex/tasks.ts）。
 * 本 migration はその期間に発行された重複 rank を一括で修復する。
 *
 * 全 projects × TASK_STATUSES の列（project × status）ごとに .collect() して
 * 全件を1トランザクションで読む（現規模で transaction 上限内に収まる前提）。
 * 将来この前提を超える規模になったら、project 単位の引数を持たせ
 * scheduler で継続実行する形に分割すること。
 */
export const repairDuplicateRanks = internalMutation({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.db.query("projects").collect();

    let scanned = 0;
    let columnsRepaired = 0;
    let tasksRepatched = 0;

    for (const project of projects) {
      for (const status of TASK_STATUSES) {
        // index (project, status, rank) 末尾が rank のため既に昇順。
        // rank が同値の場合は Convex 仕様どおり _creationTime で
        // タイブレークされるため、走査順は決定的。
        const tasks = await ctx.db
          .query("tasks")
          .withIndex("by_project_and_status", (q) =>
            q.eq("project", project._id).eq("status", status),
          )
          .collect();
        scanned += tasks.length;
        if (tasks.length === 0) continue;

        // 最初の違反（自分の rank が直前以下）の index を探す。
        let lastRank = tasks[0].rank;
        let violationIndex = -1;
        for (let i = 1; i < tasks.length; i++) {
          if (tasks[i].rank <= lastRank) {
            violationIndex = i;
            break;
          }
          lastRank = tasks[i].rank;
        }
        if (violationIndex === -1) continue;

        // 違反以降のサフィックスへ、走査順（＝現在の並び順）を保ったまま
        // rankBetween(lastRank, null) を順次発行して重複を解消する。
        columnsRepaired++;
        for (let i = violationIndex; i < tasks.length; i++) {
          const nextRank = rankBetween(lastRank, null);
          await ctx.db.patch(tasks[i]._id, {
            rank: nextRank,
            revision: tasks[i].revision + 1,
          });
          lastRank = nextRank;
          tasksRepatched++;
        }
      }
    }

    return { scanned, columnsRepaired, tasksRepatched };
  },
});
