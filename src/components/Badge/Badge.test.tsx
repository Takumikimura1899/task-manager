import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge";
import s from "./Badge.module.css";

/**
 * ステータスバッジの表示内容（ラベルの表示・ステータス別スタイルの付与・
 * 未着手系の基底スタイルへのフォールバック）を検証する。
 */

describe("Badge", () => {
  it("children をバッジのラベルとして表示する", () => {
    render(<Badge status="open">未着手</Badge>);

    expect(screen.getByText("未着手")).toHaveClass(s.badge);
  });

  it.each([["in_progress"], ["in_review"], ["done"], ["canceled"]] as const)(
    "status=%s のときステータス別スタイルを付与する",
    (status) => {
      render(<Badge status={status}>ラベル</Badge>);

      expect(screen.getByText("ラベル")).toHaveClass(s.badge, s[status]);
    },
  );

  it.each([["open"], ["todo"], ["backlog"]] as const)(
    "status=%s（未着手系）は基底スタイルのみで表示する",
    (status) => {
      render(<Badge status={status}>ラベル</Badge>);

      expect(screen.getByText("ラベル")).toHaveClass(s.badge, {
        exact: true,
      });
    },
  );
});
