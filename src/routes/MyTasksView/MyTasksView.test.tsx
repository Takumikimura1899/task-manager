import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MyTask } from "../../lib/myTasks";
import { MyTasksView } from "./MyTasksView";

/**
 * MyTasksView は tasks.listMine をこの1箇所だけで購読し、購読値を
 * groupMyTasks（純粋関数・src/lib/myTasks.test.ts で検証済み）へ渡して
 * TaskCard に描画を委ねる。ここではローディング・空状態・購読値の反映を
 * 検証する。Convex（useQuery）は外部依存のためモックする
 * （GanttView.test.tsx と同方式）。プロジェクト非依存のため
 * useAppOutletContext は使わず、MemoryRouter で包むだけでよい。
 */

const mocks = vi.hoisted(() => ({
  tasks: undefined as unknown,
}));

vi.mock("convex/react", () => ({
  useQuery: () => mocks.tasks,
}));

const createTask = (overrides: Partial<MyTask> = {}): MyTask => ({
  _id: "task_1" as Id<"tasks">,
  _creationTime: 1000,
  issue: "issue_1" as Id<"issues">,
  project: "project_1" as Id<"projects">,
  number: 9,
  title: "タスクA",
  status: "todo",
  priority: "none",
  rank: "a0",
  createdBy: "member_1" as Id<"members">,
  revision: 1,
  updatedAt: 1000,
  projectKey: "TASK",
  issueNumber: 3,
  ...overrides,
});

const renderMyTasksView = () =>
  render(
    <MemoryRouter initialEntries={["/my-tasks"]}>
      <Routes>
        <Route element={<MyTasksView />} path="/my-tasks" />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  mocks.tasks = undefined;
});

describe("MyTasksView のローディング表示", () => {
  it("読み込み中は担当 Task を読み込み中のスケルトンを表示する", () => {
    renderMyTasksView();

    expect(
      screen.getByRole("status", { name: "担当 Task を読み込み中" }),
    ).toBeInTheDocument();
  });
});

describe("MyTasksView の空状態", () => {
  it("担当 Task が0件なら案内文言と「Task 一覧へ」リンクを表示する", () => {
    mocks.tasks = [];
    renderMyTasksView();

    expect(
      screen.queryByRole("status", { name: "担当 Task を読み込み中" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /担当している Task がありません。Task の詳細画面の「担当者」で自分を選ぶと、ここに表示されます。/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Task 一覧へ" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});

describe("MyTasksView の購読値の反映", () => {
  it("status 別のセクション見出しとカードへのリンクを表示する", () => {
    mocks.tasks = [createTask({ _id: "task_1" as Id<"tasks">, number: 9 })];
    renderMyTasksView();

    expect(
      screen.getByRole("heading", { name: "未着手1" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "TASK-9" })).toHaveAttribute(
      "href",
      "/TASK/tasks/9",
    );
  });

  it("done/canceled のセクションも表示される", () => {
    mocks.tasks = [
      createTask({
        _id: "task_done" as Id<"tasks">,
        number: 1,
        status: "done",
      }),
      createTask({
        _id: "task_canceled" as Id<"tasks">,
        number: 2,
        status: "canceled",
      }),
    ];
    renderMyTasksView();

    expect(screen.getByRole("heading", { name: "完了1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "中止1" })).toBeInTheDocument();
  });
});
