import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { NotFound } from "./NotFound";

/**
 * 未定義 URL のフォールバック画面（Issue #16）の表示内容を検証する。
 * Link を含むため MemoryRouter でラップしてレンダリングする。
 * App のルーティング（path="*" への割り当て）は App.test.tsx で検証する。
 */

const renderNotFound = () =>
  render(
    <MemoryRouter>
      <NotFound />
    </MemoryRouter>,
  );

describe("NotFound", () => {
  it("見つからなかった旨の見出しと案内文を表示する", () => {
    renderNotFound();

    expect(
      screen.getByRole("heading", { name: "ページが見つかりませんでした" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/移動または削除された可能性があります/),
    ).toBeInTheDocument();
  });

  it("ホーム（一覧）へ戻るリンクを表示する", () => {
    renderNotFound();

    expect(screen.getByRole("link", { name: "← 一覧へ" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});
