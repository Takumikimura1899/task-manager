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
 * api.members.me の non-null 戻り値の型。本人自身の情報のため
 * email / role も含む（convex/members.ts 参照）。
 */
export type CurrentMember = NonNullable<
  FunctionReturnType<typeof api.members.me>
>;

/**
 * ログイン中の操作者（作成者・担当者の既定値として使う）を返すフック。
 *
 * currentMember は認証済みユーザーにリンクされた Member（api.members.me、#1）。
 * ロード中と「認証済みだが Member 未リンク」はどちらも null になるため、
 * 区別が必要な呼び出し側（未リンク案内の表示判定など）は
 * currentMemberLoading を併用する。
 *
 * members はロード中判定（`members !== undefined`）と担当者選択肢に
 * 呼び出し側が必要なため、currentMember と合わせて返す。api.members.list は
 * PII（email 等）を含まない最小限のフィールド（_id, name）のみ返す
 * （convex/members.ts 参照）。
 */
export function useCurrentMember() {
  const members = useQuery(api.members.list);
  const me = useQuery(api.members.me);

  return {
    members,
    currentMember: me ?? null,
    /** api.members.me 購読のロード中。「未リンク（null）」との区別に使う。 */
    currentMemberLoading: me === undefined,
  };
}
