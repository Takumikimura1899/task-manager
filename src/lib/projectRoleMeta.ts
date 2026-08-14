import type { ProjectRole } from "../../convex/lib/authz";

/**
 * プロジェクト内ロール（ADR-11 §3.1）の表示ラベル。
 * システム軸の Member.role（管理者/メンバー、src/lib/memberMeta.ts）とは別軸
 * のため、ラベルも独立して定義する（"member" という同一の値が別概念を指す
 * ため、1つの表に統合すると混同する）。
 */
export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  owner: "オーナー",
  member: "メンバー",
};
