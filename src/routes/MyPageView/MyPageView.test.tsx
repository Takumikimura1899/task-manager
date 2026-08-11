import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import type { CurrentMember } from "../../hooks/useCurrentMember";
import type { MyTask } from "../../lib/myTasks";
import { MyPageView } from "./MyPageView";

/**
 * MyPageView は tasks.listMine をこの1箇所だけで購読し、購読値を
 * groupMyTasksByDueDate（純粋関数・src/lib/myTasks.test.ts で検証済み）へ
 * 渡して TaskCard に描画を委ねる。currentMember / projects / selectProject は
 * AppLayout が提供する Outlet context から取り出すため、IssuesView.test.tsx
 * と同じく実物の <Outlet context> 経由で値を注入する（AppLayout 自体の
 * 実装には依存しない）。Convex（useQuery）は外部依存のためモックする。
 */

const mocks = vi.hoisted(() => ({
  tasks: undefined as unknown,
}));

vi.mock("convex/react", () => ({
  useQuery: () => mocks.tasks,
}));

const project = {
  _id: "project_1" as Id<"projects">,
  _creationTime: 1000,
  key: "TASK",
  name: "タスク管理",
  nextTaskNumber: 1,
  nextIssueNumber: 1,
} as Doc<"projects">;

const otherProject = {
  _id: "project_2" as Id<"projects">,
  _creationTime: 1000,
  key: "WEB",
  name: "Web サイト",
  nextTaskNumber: 1,
  nextIssueNumber: 1,
} as Doc<"projects">;

const createCurrentMember = (
  overrides: Partial<CurrentMember> = {},
): CurrentMember => ({
  _id: "member_1" as Id<"members">,
  name: "Alice",
  role: "member",
  email: "alice@example.com",
  ...overrides,
});

const createTask = (overrides: Partial<MyTask> = {}): MyTask => ({
  _id: "task_1" as Id<"tasks">,
  _creationTime: 1000,
  issue: "issue_1" as Id<"issues">,
  project: project._id,
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

const renderMyPageView = (
  contextOverrides: {
    projects?: Doc<"projects">[];
    currentMember?: CurrentMember | null;
    currentMemberLoading?: boolean;
    selectProject?: (id: Id<"projects">) => void;
  } = {},
) => {
  const context = {
    projects: contextOverrides.projects ?? [project],
    selected: project,
    members: undefined,
    currentMember:
      contextOverrides.currentMember !== undefined
        ? contextOverrides.currentMember
        : createCurrentMember(),
    currentMemberLoading: contextOverrides.currentMemberLoading ?? false,
    selectProject:
      contextOverrides.selectProject ?? vi.fn<(id: Id<"projects">) => void>(),
  };
  return render(
    <MemoryRouter initialEntries={["/mypage"]}>
      <Routes>
        <Route element={<Outlet context={context} />}>
          <Route element={<MyPageView />} path="/mypage" />
          <Route element={<p>Task 一覧</p>} path="/" />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  mocks.tasks = undefined;
});

describe("MyPageView のローディング表示", () => {
  it("読み込み中は担当 Task を読み込み中のスケルトンを表示する", () => {
    renderMyPageView();

    expect(
      screen.getByRole("status", { name: "担当 Task を読み込み中" }),
    ).toBeInTheDocument();
  });
});

describe("MyPageView の空状態", () => {
  it("担当 Task が0件なら案内文言と「Task 一覧へ」リンクを表示する", () => {
    mocks.tasks = [];
    renderMyPageView();

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

  it("担当 Task が done/canceled のみなら空状態を表示する", () => {
    mocks.tasks = [
      createTask({ _id: "done" as Id<"tasks">, status: "done" }),
      createTask({ _id: "canceled" as Id<"tasks">, status: "canceled" }),
    ];
    renderMyPageView();

    expect(
      screen.getByText(/担当している Task がありません。/),
    ).toBeInTheDocument();
  });
});

describe("MyPageView のプロフィール行", () => {
  it("読み込み中は aria-label 付きのスケルトンを表示する（規約: 裸の Skeleton を置かない）", () => {
    mocks.tasks = [];
    renderMyPageView({ currentMember: null, currentMemberLoading: true });

    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "プロフィールを読み込み中" }),
    ).toBeInTheDocument();
  });

  it("名前と role を表示する", () => {
    mocks.tasks = [];
    renderMyPageView({
      currentMember: createCurrentMember({ name: "テスト太郎", role: "admin" }),
    });

    expect(screen.getByText("テスト太郎")).toBeInTheDocument();
    expect(screen.getByText("管理者")).toBeInTheDocument();
  });
});

describe("MyPageView の所属プロジェクトチップ", () => {
  it("担当 Task が無ければチップを表示しない", () => {
    mocks.tasks = [];
    renderMyPageView();

    expect(screen.queryByRole("link", { name: /のカンバンへ/ })).toBeNull();
  });

  it("担当 Task を持つプロジェクトをチップとして重複無く表示する", () => {
    mocks.tasks = [
      createTask({ _id: "t1" as Id<"tasks">, project: project._id }),
      createTask({
        _id: "t2" as Id<"tasks">,
        project: project._id,
        number: 10,
      }),
      createTask({
        _id: "t3" as Id<"tasks">,
        project: otherProject._id,
        projectKey: "WEB",
        number: 1,
      }),
    ];
    renderMyPageView({ projects: [project, otherProject] });

    expect(
      screen.getByRole("link", { name: "TASK（タスク管理）のカンバンへ" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "WEB（Web サイト）のカンバンへ" }),
    ).toBeInTheDocument();
  });

  it("チップをクリックするとプロジェクトを選択してカンバンへ遷移する", async () => {
    const user = userEvent.setup();
    const selectProject = vi.fn<(id: Id<"projects">) => void>();
    mocks.tasks = [createTask({ project: project._id })];
    renderMyPageView({ selectProject });

    await user.click(
      screen.getByRole("link", { name: "TASK（タスク管理）のカンバンへ" }),
    );

    expect(selectProject).toHaveBeenCalledWith(project._id);
    expect(screen.getByText("Task 一覧")).toBeInTheDocument();
  });
});

describe("MyPageView の期限軸グルーピング", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 11)); // 2026-08-11
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("期限軸のセクション見出しとカードへのリンクを表示する", () => {
    mocks.tasks = [
      createTask({ _id: "task_1" as Id<"tasks">, dueDate: "2026-08-11" }),
    ];
    renderMyPageView();

    expect(screen.getByRole("heading", { name: "今日1" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "TASK-9" })).toHaveAttribute(
      "href",
      "/TASK/tasks/9",
    );
  });

  it("done/canceled の Task はどのセクションにも表示されない", () => {
    mocks.tasks = [
      createTask({
        _id: "task_active" as Id<"tasks">,
        number: 1,
        dueDate: "2026-08-11",
      }),
      createTask({
        _id: "task_done" as Id<"tasks">,
        number: 2,
        status: "done",
        dueDate: "2026-08-11",
      }),
    ];
    renderMyPageView();

    expect(screen.getByRole("heading", { name: "今日1" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "TASK-2" })).toBeNull();
  });

  it("各カードに status バッジを表示する", () => {
    mocks.tasks = [
      createTask({
        _id: "task_1" as Id<"tasks">,
        status: "in_progress",
        dueDate: "2026-08-11",
      }),
    ];
    renderMyPageView();

    expect(screen.getByText("進行中")).toBeInTheDocument();
  });

  it("日付境界を跨ぐと today が更新され、期限バケットが翌日基準に切り替わる（レビュー指摘#2の回帰防止）", () => {
    vi.setSystemTime(new Date(2026, 7, 11, 23, 59, 30)); // 2026-08-11 23:59:30
    mocks.tasks = [
      createTask({ _id: "task_1" as Id<"tasks">, dueDate: "2026-08-12" }),
    ];
    renderMyPageView();

    // 08-11 時点では dueDate は today+1 なので「今後7日」バケット
    expect(
      screen.getByRole("heading", { name: "今後7日1" }),
    ).toBeInTheDocument();

    // 日付境界（+1秒の余裕）を跨ぐまで進めると、購読データの変化なしでも
    // today が前進する（useTodayIso の自前タイマー）
    act(() => {
      vi.advanceTimersByTime(32_000);
    });

    // 08-12 になった今、dueDate 08-12 は today 自身なので「今日」バケットへ移る
    expect(screen.getByRole("heading", { name: "今日1" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "今後7日1" }),
    ).not.toBeInTheDocument();
  });
});
