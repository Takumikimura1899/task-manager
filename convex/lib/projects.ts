import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * projectKey → Project の解決（{key}-{number} / {key}#{number} 参照の共通前段）。
 * by_key インデックスで一意に引く（key の一意性は projects.create で保証）。
 * 見つからなければ null を返す（エラーにするかは呼び出し元の契約に委ねる）。
 */
export async function findProjectByKey(
  ctx: QueryCtx,
  key: string,
): Promise<Doc<"projects"> | null> {
  return await ctx.db
    .query("projects")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
}
