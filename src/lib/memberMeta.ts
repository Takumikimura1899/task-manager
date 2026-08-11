import type { Doc } from "../../convex/_generated/dataModel";

export type MemberRole = Doc<"members">["role"];

/** Member の role の表示ラベル（My Page プロフィール行等で共有）。 */
export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  admin: "管理者",
  member: "メンバー",
};
