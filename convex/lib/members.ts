import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

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
