import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NoMembersNotice } from "./NoMembersNotice";

/**
 * メンバー未登録時の空状態案内（Issue #16）の表示内容を検証する。
 * Home はメンバー 0 件のとき作成フォームの代わりにこの案内を表示する
 * （Home 自体は Convex の useQuery に依存するため、表示部分を切り出して検証する）。
 */

describe("NoMembersNotice", () => {
  it("作成できない理由と登録手段を案内する", () => {
    render(<NoMembersNotice />);

    const notice = screen.getByRole("note");
    expect(notice).toHaveTextContent(
      "メンバーが登録されていないため、Issue / タスクを作成できません。",
    );
    expect(notice).toHaveTextContent(
      "MCP もしくは Convex ダッシュボードからメンバーを登録してください。",
    );
  });
});
