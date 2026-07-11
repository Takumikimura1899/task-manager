import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import type { BoardTask } from "../../lib/board";
import { type TaskStatus, TASK_STATUS_ORDER } from "../../lib/taskMeta";
import { Home } from "./Home";

/**
 * Home のローディング表示（Issue #29）とプロジェクト切替（Issue #74）を検証する。
 * Convex は外部依存のためモックする。api の関数参照（anyApi）は参照同一性を
 * 持たないため、getFunctionName で "module:function" 名に解決してディスパッチ
 * する。
 */

const { useQueryMock, mutate } = vi.hoisted(() => ({
  useQueryMock:
    vi.fn<
      (name: string, args: Record<string, unknown> | undefined) => unknown
    >(),
  mutate: vi.fn<(args: unknown) => Promise<unknown>>(),
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (
      query: Parameters<typeof getFunctionName>[0],
      args?: Record<string, unknown>,
    ) => useQueryMock(getFunctionName(query), args),
    useMutation: () => mutate,
  };
});

const createProject = (overrides: Record<string, unknown> = {}) =>
  ({
    _id: "project_1" as Id<"projects">,
    _creationTime: 1000,
    key: "TASK",
    name: "タスク管理",
    ...overrides,
  }) as Doc<"projects">;

const createMember = (overrides: Record<string, unknown> = {}) =>
  ({
    _id: "member_1" as Id<"members">,
    _creationTime: 1000,
    name: "Alice",
    ...overrides,
  }) as Doc<"members">;

const createTask = (overrides: Partial<BoardTask> = {}): BoardTask => ({
  _id: "task_1" as Id<"tasks">,
  _creationTime: 1000,
  issue: "issue_1" as Id<"issues">,
  project: "project_1" as Id<"projects">,
  number: 12,
  title: "ログイン不具合を修正する",
  status: "todo" as Doc<"tasks">["status"],
  priority: "high" as Doc<"tasks">["priority"],
  rank: "a0",
  createdBy: "member_1" as Id<"members">,
  revision: 1,
  updatedAt: 1000,
  issueNumber: 34,
  assigneeName: "Alice",
  ...overrides,
});

const createColumns = (
  tasksByStatus: Partial<Record<TaskStatus, BoardTask[]>> = {},
) =>
  TASK_STATUS_ORDER.map((status) => ({
    status,
    tasks: tasksByStatus[status] ?? [],
  }));

const renderHome = () =>
  render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  );

beforeEach(() => {
  useQueryMock.mockReset();
  mutate.mockReset();
  sessionStorage.clear();
});

describe("Home のローディング表示", () => {
  it("読み込み中もタイトルを維持したままスケルトンを表示する", () => {
    // すべての購読が読み込み中（undefined）
    renderHome();

    expect(
      screen.getByRole("heading", { name: "Task Manager" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "プロジェクトを読み込み中" }),
    ).toBeInTheDocument();
  });
});

describe("Home のプロジェクト切替（Issue #74）", () => {
  it("切替直後は旧プロジェクトのカードを残さず、ボードをロード中表示にする", async () => {
    const user = userEvent.setup();
    const projectA = createProject();
    const projectB = createProject({
      _id: "project_2" as Id<"projects">,
      key: "WEB",
      name: "Web サイト",
    });
    // Convex の購読は同じスナップショットに対して同一参照を返す。
    // 毎回新しい配列を返すと Board の同期 effect（参照比較）が無限ループする
    // ため、実物同様に安定した参照を返す。
    const projects = [projectA, projectB];
    const members = [createMember()];
    const issues: never[] = [];
    const columnsA = createColumns({ todo: [createTask()] });
    useQueryMock.mockImplementation((name, args) => {
      switch (name) {
        case "projects:list":
          return projects;
        case "members:list":
          return members;
        case "issues:list":
          return issues;
        case "tasks:board":
          // 旧プロジェクトのみデータ済み。新プロジェクトはロード中（undefined）
          return args?.project === projectA._id ? columnsA : undefined;
        default:
          return undefined;
      }
    });
    renderHome();

    // 切替前：旧プロジェクトのカードが表示されている
    expect(screen.getByRole("link", { name: "TASK-12" })).toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "プロジェクト" }),
      projectB._id,
    );

    // 切替直後：Board が再マウントされ、旧プロジェクトのカードは表示されず
    // ロード中のスケルトンになる（旧カードが残ると WEB-12 等の不正 URL へ
    // 遷移できてしまう）
    expect(
      screen.queryByRole("link", { name: "TASK-12" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "ボードを読み込み中" }),
    ).toBeInTheDocument();
  });
});
