import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireActor } from "./lib/auth";
import { encryptSecret } from "./lib/crypto";

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

export const create = mutation({
  args: {
    project: v.id("projects"),
    remoteUrl: v.string(),
    webhookSecret: v.string(),
    accessToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireActor(ctx, args.accessToken);

    if ((await ctx.db.get(args.project)) === null) {
      throw new ConvexError("指定されたプロジェクトが存在しません");
    }

    const encrypted = await encryptSecret(args.webhookSecret, encryptionKey());
    return await ctx.db.insert("repositories", {
      project: args.project,
      provider: "github",
      remoteUrl: args.remoteUrl,
      webhookSecret: encrypted,
    });
  },
});

/** プロジェクトのリポジトリ一覧（webhookSecret は除外して返す）。 */
export const listByProject = query({
  args: { project: v.id("projects"), accessToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireActor(ctx, args.accessToken);

    const repos = await ctx.db
      .query("repositories")
      .withIndex("by_project", (q) => q.eq("project", args.project))
      .collect();
    return repos.map(({ webhookSecret: _omit, ...rest }) => rest);
  },
});
