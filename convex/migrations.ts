import { internalMutation } from "./_generated/server";
import { TASK_STATUSES } from "./lib/taskStatus";
import { rankBetween } from "./lib/rank";
import { normalizeEmail } from "./lib/validators";

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
          // nextMeta は使わない: これはユーザー操作ではなく system 起因の
          // データ訂正のため、対象 Task の updatedAt（「最終更新」表示・
          // 更新日時ソートに使われる）を実行時刻で汚さない。OCC の対象には
          // 含めたいので revision だけは進める。
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

/**
 * ADR-11 バックフィル（§3.1 移行）。冪等・再実行可能。
 *
 * projectMembers 導入以前は「認証済み Member なら誰でも全プロジェクトを
 * 操作可能」だったため、既存データにはロール境界が存在しない。
 * 全 projects × 全 members について membership が無ければ挿入し、その動作を
 * 保存する:
 * - 人間 Member → owner（現状の「全員が全プロジェクト操作可」を保存）
 * - エージェント Member（email === MCP_AGENT_EMAIL）→ member
 *   （MCP_AGENT_EMAIL 未設定ならエージェント無しとして全員 owner。
 *   requireAgentEmail は未設定・不正形式を throw するため使わず、
 *   normalizeEmail のみを流用する＝バックフィルは env 未設定で失敗させない）
 *
 * 実行後にプロジェクトが増減しても、新規プロジェクトは projects.create が
 * 作成者を owner として同時挿入するため隙間は生じない（設計書 §6）。
 */
export const backfillProjectMembers = internalMutation({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.db.query("projects").collect();
    const members = await ctx.db.query("members").collect();

    // (project, member) の既存 membership を1回の .collect() で読み、
    // "project|member" キーの Set で存在判定する。ペアごとに .unique() を
    // 逐次発行する O(P×M) の点クエリを避けるための構造化（O(P×M) → O(P+M)）。
    const existingMemberships = await ctx.db.query("projectMembers").collect();
    const existingKeys = new Set(
      existingMemberships.map((m) => `${m.project}|${m.member}`),
    );

    const rawAgentEmail = process.env.MCP_AGENT_EMAIL;
    const agentEmail =
      rawAgentEmail === undefined || rawAgentEmail === ""
        ? null
        : normalizeEmail(rawAgentEmail);

    let inserted = 0;
    let skipped = 0;

    for (const project of projects) {
      for (const member of members) {
        if (existingKeys.has(`${project._id}|${member._id}`)) {
          skipped++;
          continue;
        }

        const role = member.email === agentEmail ? "member" : "owner";
        await ctx.db.insert("projectMembers", {
          project: project._id,
          member: member._id,
          role,
        });
        inserted++;
      }
    }

    return {
      projects: projects.length,
      members: members.length,
      inserted,
      skipped,
    };
  },
});
