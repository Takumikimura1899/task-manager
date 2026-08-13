import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * projectId を直接持たない公開関数（taskId / issueId / repositoryId しか
 * 受けない）のために、親を辿って projectId を解決する小関数群
 * （convex/lib/auth.ts の projectQuery / projectMutation の
 * resolveProject/opts.project に渡す。設計書 §3.3）。
 *
 * ビルダーが親エンティティを読み、handler が同じエンティティを再度読む
 * 二重読みが発生するが、同一トランザクション内で整合し、コストも軽微。
 * ビルダーの汎用性（解決済み doc の受け渡し抽象を作らない）を優先する。
 */

export async function projectOfTask(
  ctx: QueryCtx,
  id: Id<"tasks">,
): Promise<Id<"projects"> | null> {
  const task = await ctx.db.get(id);
  return task === null ? null : task.project;
}

export async function projectOfIssue(
  ctx: QueryCtx,
  id: Id<"issues">,
): Promise<Id<"projects"> | null> {
  const issue = await ctx.db.get(id);
  return issue === null ? null : issue.project;
}

export async function projectOfRepository(
  ctx: QueryCtx,
  id: Id<"repositories">,
): Promise<Id<"projects"> | null> {
  const repository = await ctx.db.get(id);
  return repository === null ? null : repository.project;
}

/**
 * projectId をそのまま受ける関数向けの実在確認（設計書 §10 D1）。
 * 単に `Promise.resolve(id)` を渡すと、存在しない project id でも
 * 「参加していません」という認可拒否になり、存在失敗と認可失敗が入れ替わる
 * （非参加者へ「project は存在するが非参加」を漏らす一方、「project 自体が
 * 存在しない」ケースを隠してしまう）。ここで実在確認まで済ませる。
 */
export async function projectOfProjectId(
  ctx: QueryCtx,
  id: Id<"projects">,
): Promise<Id<"projects"> | null> {
  const project = await ctx.db.get(id);
  return project === null ? null : id;
}
