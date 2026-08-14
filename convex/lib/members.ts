import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { normalizeEmail } from "./validators";

/**
 * email から member を1件解決する（正規化込み）。
 * members.by_email への問い合わせが members.ts（create / getByEmail /
 * ensureAgent）・lib/memberLink.ts・lib/auth.ts（resolveAgentMember）・
 * projectMembers.ts（grantProjectMembership）の6箇所で重複していたため
 * 一元化する（正規化ロジックの二重管理も同時に解消する）。
 */
export async function findMemberByEmail(
  ctx: QueryCtx,
  email: string,
): Promise<Doc<"members"> | null> {
  return await ctx.db
    .query("members")
    .withIndex("by_email", (q) => q.eq("email", normalizeEmail(email)))
    .unique();
}

/**
 * member の表示名を解決する（PII 配慮で name のみ返す）。
 * 未指定（undefined）や実体欠落時は null を返す。
 */
export async function resolveMemberName(
  ctx: QueryCtx,
  id: Id<"members"> | undefined,
): Promise<string | null> {
  if (id === undefined) return null;
  const member = await ctx.db.get(id);
  return member?.name ?? null;
}

/**
 * 複数の member id をまとめて名前解決する（重複 id は1回の取得に集約）。
 * members テーブル全件の .collect() を避け、参照された分だけ境界付きで読む
 * （Convex guidelines: 非境界の .collect() を使わない）。
 */
export async function resolveMemberNames(
  ctx: QueryCtx,
  ids: readonly (Id<"members"> | undefined)[],
): Promise<Map<Id<"members">, string>> {
  const distinct = [
    ...new Set(ids.filter((id): id is Id<"members"> => id !== undefined)),
  ];
  const names = new Map<Id<"members">, string>();
  await Promise.all(
    distinct.map(async (id) => {
      const member = await ctx.db.get(id);
      if (member !== null) names.set(id, member.name);
    }),
  );
  return names;
}
