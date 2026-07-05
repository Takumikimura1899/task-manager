import s from "./NoMembersNotice.module.css";

/**
 * メンバー未登録時の空状態案内（Issue #16）。
 * 認証未実装（Phase2、#1）の暫定仕様では先頭メンバーを作成者に使うため、
 * メンバーが 0 件だと Issue / タスクの作成手段が消える。フォームを黙って
 * 非表示にせず、作成できない理由と登録手段を案内する。
 */
export function NoMembersNotice() {
  return (
    <p className={s.notice} role="note">
      メンバーが登録されていないため、Issue / タスクを作成できません。MCP
      もしくは Convex ダッシュボードからメンバーを登録してください。
    </p>
  );
}
