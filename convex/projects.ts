import { ConvexError, v } from "convex/values";
import {
  actorMutation,
  authedQuery,
  projectQuery,
  requireViewer,
} from "./lib/auth";
import { findProjectByKey } from "./lib/projects";
import { isValidProjectKey } from "./lib/validators";

/**
 * Project の Core API（基本設計書 §3 / §4 設計原則1）。
 * key の一意性（INVARIANT）は by_key インデックスでの存在確認＋
 * Convex のトランザクション（OCC）により保証する。
 */

export const create = actorMutation(
  {
    key: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
  },
  async (ctx, args, actor) => {
    if (!isValidProjectKey(args.key)) {
      throw new ConvexError(
        `プロジェクトキーが不正です: "${args.key}"（大文字英字2〜10文字）`,
      );
    }

    const existing = await findProjectByKey(ctx, args.key);
    if (existing !== null) {
      throw new ConvexError(
        `プロジェクトキー "${args.key}" は既に使用されています`,
      );
    }

    const projectId = await ctx.db.insert("projects", {
      key: args.key,
      name: args.name,
      description: args.description,
      // 採番は 1 から開始（INVARIANT-1）。Task / Issue で別カウンタ。
      nextTaskNumber: 1,
      nextIssueNumber: 1,
    });

    // 作成者を owner として同一トランザクション内で原子的に membership 化する
    // （ADR-11。owner 不在プロジェクトを生まないための唯一の公開作成経路。
    // Convex の mutation は単一トランザクションのため原子性は自動で満たされる）。
    await ctx.db.insert("projectMembers", {
      project: projectId,
      member: actor._id,
      role: "owner",
    });

    return projectId;
  },
);

export const getByKey = projectQuery(
  { key: v.string() },
  async (ctx, args) => (await findProjectByKey(ctx, args.key))?._id ?? null,
  async (ctx, args) => await findProjectByKey(ctx, args.key),
);

/**
 * 参加プロジェクトのみを返す(ADR-11 §3.1「参加のみ可視」)。「参加のみ」は
 * 認可ゲートではなく list の検索条件そのものなので、単一使用箇所のために
 * viewerQuery ビルダーは新設しない(設計書 §3.6)。
 */
export const list = authedQuery({}, async (ctx, args) => {
  const viewer = await requireViewer(ctx, args.accessToken);
  if (viewer === null) return [];

  const memberships = await ctx.db
    .query("projectMembers")
    .withIndex("by_member", (q) => q.eq("member", viewer._id))
    .collect();

  const projects = await Promise.all(
    memberships.map((m) => ctx.db.get(m.project)),
  );

  return projects.flatMap((project, i) => {
    if (project === null) {
      // 参照整合性の異常(project が削除されているのに membership が残る)。
      // 握り潰さず、ログに残した上で当該行だけスキップする
      // (convex/tasks.ts:701-719 の既存パターン踏襲・設計書 §10 D4)。
      console.warn(
        `projects.list: Project ${memberships[i].project} が見つかりません`,
      );
      return [];
    }
    return [project];
  });
});
