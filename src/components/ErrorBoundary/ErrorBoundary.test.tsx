import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

/**
 * エラー境界の振る舞い（正常時の素通し・例外捕捉時のフォールバック表示・
 * 再試行による children の再マウント復帰）を検証する。
 * throw する子はテスト用のダミーコンポーネント（外部依存ではないため実物）。
 */

// モジュールレベルの可変フラグで throw を制御する。
// props で制御すると再試行時も同じ element が再描画されて throw し続けるため、
// 「エラー原因が解消された後の再試行で復帰する」シナリオを表現できない。
let shouldThrow = false;

function Bomb() {
  if (shouldThrow) {
    throw new Error("クエリの失敗を模したテスト用エラー");
  }
  return <p>正常なコンテンツ</p>;
}

const renderBoundary = () =>
  render(
    <ErrorBoundary>
      <Bomb />
    </ErrorBoundary>,
  );

describe("ErrorBoundary", () => {
  beforeEach(() => {
    shouldThrow = false;
    // React が捕捉済みエラーを console.error に出力しテストログを汚すため抑止する。
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("正常時は children をそのまま表示する", () => {
    renderBoundary();

    expect(screen.getByText("正常なコンテンツ")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("子が throw したらフォールバック UI を表示する", () => {
    shouldThrow = true;
    renderBoundary();

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "エラーが発生しました" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
    expect(screen.queryByText("正常なコンテンツ")).not.toBeInTheDocument();
  });

  it("エラー原因の解消後に再試行すると children が再マウントされ復帰する", async () => {
    const user = userEvent.setup();
    shouldThrow = true;
    renderBoundary();

    shouldThrow = false;
    await user.click(screen.getByRole("button", { name: "再試行" }));

    expect(screen.getByText("正常なコンテンツ")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("エラー原因が続いたまま再試行してもフォールバック UI に戻る", async () => {
    const user = userEvent.setup();
    shouldThrow = true;
    renderBoundary();

    await user.click(screen.getByRole("button", { name: "再試行" }));

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("正常なコンテンツ")).not.toBeInTheDocument();
  });
});
