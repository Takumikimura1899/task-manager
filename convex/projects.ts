import { ConvexError, v } from "convex/values";
import { actorMutation, authedQuery } from "./lib/auth";
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
    // （ADR-11。owner 不在プロジェクトを生まないための唯一のシード経路。
    // Convex の mutation は単一トランザクションのため原子性は自動で満たされる）。
    await ctx.db.insert("projectMembers", {
      project: projectId,
      member: actor._id,
      role: "owner",
    });

    return projectId;
  },
);

export const getByKey = authedQuery({ key: v.string() }, async (ctx, args) => {
  return await findProjectByKey(ctx, args.key);
});

export const list = authedQuery({}, async (ctx) => {
  return await ctx.db.query("projects").collect();
});
