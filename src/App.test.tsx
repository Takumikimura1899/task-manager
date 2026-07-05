import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "./App";

/**
 * ルーティングのフォールバック（path="*"、Issue #16）を検証する。
 * 未知 URL では NotFound だけがマウントされ Convex の useQuery を呼ぶ
 * コンポーネントは描画されないため、ConvexProvider なしでテストできる。
 * 既存ルート（Home / 詳細画面）の描画内容は各画面のテストに委ねる。
 */

describe("App のルーティング", () => {
  it.each([
    ["/no-such-page"],
    ["/TASK/tasks/1/extra"], // 既存ルートより深い未知パス
  ])("未定義の URL %s では NotFound を表示する", (path) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: "ページが見つかりませんでした" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← 一覧へ" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});
