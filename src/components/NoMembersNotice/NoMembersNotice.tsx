import s from "./NoMembersNotice.module.css";

/**
 * ログイン中アカウントに対応する Member が未リンク時の空状態案内
 * （Issue #16 / #1）。作成系フォームは操作者（currentMember）を必要と
 * するため、未リンクだと Issue / Task の作成手段が消える。フォームを
 * 黙って非表示にせず、作成できない理由と依頼先を案内する。
 */
export function NoMembersNotice() {
  return (
    <p className={s.notice} role="note">
      ログイン中のアカウントに対応するメンバーが登録されていないため、Issue /
      Task を作成できません。管理者にメンバー登録を依頼してください。
    </p>
  );
}
