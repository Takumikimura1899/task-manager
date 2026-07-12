import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";

/**
 * api.members.list の戻り値要素の型（_id, name のみ）。
 * Doc<"members"> ではない点に注意: PII（email 等）を含まない最小限の
 * フィールドしか返さないため（convex/members.ts 参照）、実際の戻り型から
 * 導出したこの型を単一の情報源として使う（AppOutletContext 等）。
 */
export type MemberSummary = FunctionReturnType<typeof api.members.list>[number];

/**
 * ログイン中の操作者（作成者・担当者の既定値として使う）を返すフック。
 *
 * 認証は未実装（Phase2、#1）のため、暫定的に先頭メンバーを作成者とする。
 * この規約は AppLayout / IssueDetail / TaskDetail など複数画面で使うため、
 * ここに一元化する（Phase2 導入時はここだけ差し替えればよい）。
 *
 * members はロード中判定（`members !== undefined`）に呼び出し側が必要なため、
 * currentMember と合わせて返す。api.members.list は PII（email 等）を含まない
 * 最小限のフィールド（_id, name）のみ返す（convex/members.ts 参照）。
 */
export function useCurrentMember() {
  const members = useQuery(api.members.list);
  const currentMember = members?.[0] ?? null;

  return { members, currentMember };
}
