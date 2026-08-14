import { render, screen } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DetailErrorBoundary } from "./DetailErrorBoundary";
import { ErrorBoundary } from "./ErrorBoundary";

/**
 * 非参加 linked Member の deep link（projectQuery の ConvexError
 * 「このプロジェクトに参加していません」）を DetailNotFound 相当の案内に
 * 縮退させ、それ以外の例外は親の汎用 ErrorBoundary へ委譲することを検証する
 * （監査 PLAUSIBLE 指摘）。throw する子はテスト用のダミーコンポーネント。
 */

let error: unknown = null;

function Bomb() {
  if (error !== null) {
    throw error;
  }
  return <p>正常なコンテンツ</p>;
}

const renderBoundary = () =>
  render(
    <MemoryRouter>
      <ErrorBoundary>
        <DetailErrorBoundary backTo="/issues" entity="Issue">
          <Bomb />
        </DetailErrorBoundary>
      </ErrorBoundary>
    </MemoryRouter>,
  );

describe("DetailErrorBoundary", () => {
  beforeEach(() => {
    error = null;
    // React が捕捉済みエラーを console.error に出力しテストログを汚すため抑止する。
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("正常時は children をそのまま表示する", () => {
    renderBoundary();

    expect(screen.getByText("正常なコンテンツ")).toBeInTheDocument();
  });

  it("非参加拒否の ConvexError は DetailNotFound 相当の案内に縮退させる", () => {
    error = new ConvexError("このプロジェクトに参加していません");
    renderBoundary();

    expect(
      screen.getByText("Issue が見つかりませんでした。"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "エラーが発生しました" }),
    ).not.toBeInTheDocument();
  });

  it("非参加拒否以外の例外は親の汎用 ErrorBoundary に委譲する", () => {
    error = new Error("想定外のエラー");
    renderBoundary();

    expect(
      screen.getByRole("heading", { name: "エラーが発生しました" }),
    ).toBeInTheDocument();
  });

  it("非参加拒否以外の ConvexError は親の汎用 ErrorBoundary に委譲する", () => {
    error = new ConvexError("別のエラーメッセージ");
    renderBoundary();

    expect(
      screen.getByRole("heading", { name: "エラーが発生しました" }),
    ).toBeInTheDocument();
  });
});
