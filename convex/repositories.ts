import { ConvexError, v } from "convex/values";
import { projectMutation, projectQuery } from "./lib/auth";
import { encryptSecret } from "./lib/crypto";
import { projectOfProjectId } from "./lib/projectScope";

/**
 * Repository の Core API（基本設計書 §3 / §7）。
 * webhookSecret は保存時に AES-256-GCM で暗号化する（§3）。平文 secret は
 * クライアントに返さない（query は secret を除外して返す）。
 */

function encryptionKey(): string {
  const key = process.env.WEBHOOK_ENCRYPTION_KEY;
  if (key === undefined || key === "") {
    throw new ConvexError(
      "WEBHOOK_ENCRYPTION_KEY が設定されていません（convex env set で設定してください）",
    );
  }
  return key;
}

export const create = projectMutation(
  {
    project: v.id("projects"),
    remoteUrl: v.string(),
    webhookSecret: v.string(),
  },
  {
    // webhookSecret を生む操作のため owner 専用（設計書 §4）。
    permission: "project.settings.edit",
    project: (ctx, args) => projectOfProjectId(ctx, args.project),
  },
  async (ctx, args) => {
    const encrypted = await encryptSecret(args.webhookSecret, encryptionKey());
    return await ctx.db.insert("repositories", {
      project: args.project,
      provider: "github",
      remoteUrl: args.remoteUrl,
      webhookSecret: encrypted,
    });
  },
);

/** プロジェクトのリポジトリ一覧（webhookSecret は除外して返す）。member も閲覧可。 */
export const listByProject = projectQuery(
  { project: v.id("projects") },
  (ctx, args) => projectOfProjectId(ctx, args.project),
  async (ctx, args) => {
    const repos = await ctx.db
      .query("repositories")
      .withIndex("by_project", (q) => q.eq("project", args.project))
      .collect();
    return repos.map(({ webhookSecret: _omit, ...rest }) => rest);
  },
);
