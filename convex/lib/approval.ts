/**
 * Human-in-the-Loop 承認ゲート（基本設計書 §6）。
 *
 * done / canceled への遷移とタスク・Issue の削除は破壊的操作であり、AI エージェント
 * （MCP 経由の自動化）からの実行には人間の承認を必須とする。
 * 承認判定をこのモジュールに純粋関数として一元化し、MCP サーバーは判定結果に
 * 従って操作を拒否する薄い結線に留める。
 *
 * 強制は MCP 境界で行う（UI からの操作は人間自身によるものなのでゲート不要。
 * Convex mutation 側にはこのゲートを置かない）。
 */
import { requiresApproval, type TaskStatus } from "./taskStatus";

/** 承認判定の結果。拒否時は呼び出し元へ返すエラーメッセージを伴う。 */
export type ApprovalDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

const RETRY_INSTRUCTION =
  "人間の承認が必要です。ユーザーに承認を得た上で approved: true を指定して再実行してください。";

/**
 * transition_status の承認判定。
 * 遷移先が承認必須（done / canceled）の場合、approved: true が無ければ拒否する。
 */
export function checkTransitionApproval(
  to: TaskStatus,
  approved: boolean | undefined,
): ApprovalDecision {
  if (!requiresApproval(to) || approved === true) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `${to} への遷移は破壊的操作のため、${RETRY_INSTRUCTION}`,
  };
}

/**
 * delete_task / delete_issue の承認判定。
 * 削除は常に承認必須（§6）。approved: true が無ければ拒否する。
 * subject には削除対象の呼称（"タスク" / "Issue"）を渡し、拒否メッセージに用いる。
 */
export function checkDeleteApproval(
  approved: boolean | undefined,
  subject: "タスク" | "Issue" = "タスク",
): ApprovalDecision {
  if (approved === true) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `${subject}の削除は破壊的操作のため、${RETRY_INSTRUCTION}`,
  };
}
