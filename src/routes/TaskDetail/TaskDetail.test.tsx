import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { TaskDetail } from "./TaskDetail";

/**
 * Task 詳細のローディング表示（Issue #29）を検証する。
 * 読み込み中も全画面差し替えにせず、戻り導線（← 一覧へ）を維持したまま
 * スケルトンを表示すること。Convex は外部依存のためモックする。
 */

vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useMutation: () => vi.fn<() => Promise<unknown>>(),
}));

describe("TaskDetail のローディング表示", () => {
  it("読み込み中も戻り導線を維持したままスケルトンを表示する", () => {
    render(
      <MemoryRouter initialEntries={["/TASK/tasks/12"]}>
        <Routes>
          <Route element={<TaskDetail />} path="/:projectKey/tasks/:number" />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("status", { name: "タスクを読み込み中" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← 一覧へ" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});
