import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Home } from "./Home";

/**
 * Home のローディング表示（Issue #29）を検証する。
 * プロジェクト読み込み中も全画面差し替えにせず、タイトルを維持したまま
 * スケルトンを表示すること。Convex は外部依存のためモックする
 * （projects / members とも読み込み中＝undefined を返す）。
 */

vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useMutation: () => vi.fn<() => Promise<unknown>>(),
}));

describe("Home のローディング表示", () => {
  it("読み込み中もタイトルを維持したままスケルトンを表示する", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { name: "Task Manager" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "プロジェクトを読み込み中" }),
    ).toBeInTheDocument();
  });
});
