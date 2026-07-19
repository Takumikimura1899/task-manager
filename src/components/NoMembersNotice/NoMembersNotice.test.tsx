import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NoMembersNotice } from "./NoMembersNotice";

/**
 * Member 未リンク時の空状態案内（Issue #16 / #1）の表示内容を検証する。
 * AppLayout / IssueDetail は members.me が null（認証済みだが対応する
 * Member 未登録）のとき作成フォームの代わりにこの案内を表示する
 * （表示条件側は各画面のテストが検証するため、ここは文言のみ検証する）。
 */

describe("NoMembersNotice", () => {
  it("作成できない理由と依頼先を案内する", () => {
    render(<NoMembersNotice />);

    const notice = screen.getByRole("note");
    expect(notice).toHaveTextContent(
      "ログイン中のアカウントに対応するメンバーが登録されていないため、Issue / Task を作成できません。",
    );
    expect(notice).toHaveTextContent(
      "管理者にメンバー登録を依頼してください。",
    );
  });
});
