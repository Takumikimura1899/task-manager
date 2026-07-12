import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { AppLayout } from "./AppLayout";

/**
 * AppLayout のローディング表示（Issue #29）・プロジェクト0件分岐・
 * タブナビ（/ タスク・/issues Issue）・プロジェクト選択 select を検証する。
 * Convex は外部依存のためモックする。projects.list / members.list はいずれも
 * 引数なしで呼ばれるため args では区別できず、api の関数参照（anyApi）も
 * 参照同一性を持たない。getFunctionName で "module:function" 名に解決して
 * ディスパッチする（旧 Home.test.tsx と同方式）。
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
    nextTaskNumber: 1,
    nextIssueNumber: 1,
    ...overrides,
  }) as Doc<"projects">;

const createMember = (overrides: Record<string, unknown> = {}) =>
  ({
    _id: "member_1" as Id<"members">,
    _creationTime: 1000,
    name: "Alice",
    email: "alice@example.com",
    role: "member",
    ...overrides,
  }) as Doc<"members">;

// 子ルート（TasksView / IssuesView）の描画内容は各画面のテストに委ねる。
// ここでは AppLayout 自身の責務（ローディング・0件分岐・タブ・select）だけを
// 検証するため、プレースホルダを子ルートに置く。
const renderAppLayout = (initialEntries: string[] = ["/"]) =>
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route element={<p>タスク画面</p>} path="/" />
          <Route element={<p>Issue画面</p>} path="/issues" />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  useQueryMock.mockReset();
  mutate.mockReset();
  sessionStorage.clear();
});

describe("AppLayout のローディング表示（Issue #29）", () => {
  it("読み込み中もタイトルを維持したままスケルトンを表示する", () => {
    // すべての購読が読み込み中（undefined）
    renderAppLayout();

    expect(
      screen.getByRole("heading", { name: "Task Manager" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "プロジェクトを読み込み中" }),
    ).toBeInTheDocument();
  });
});

describe("AppLayout のプロジェクト0件分岐", () => {
  it("プロジェクトが1件も無い場合は作成手段の案内を表示する", () => {
    useQueryMock.mockImplementation((name) =>
      name === "projects:list" ? [] : undefined,
    );
    renderAppLayout();

    expect(
      screen.getByRole("heading", { name: "Task Manager" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "プロジェクトがありません。MCP もしくは Convex ダッシュボードから作成してください。",
      ),
    ).toBeInTheDocument();
  });
});

describe("AppLayout のタブナビ", () => {
  beforeEach(() => {
    const project = createProject();
    const member = createMember();
    useQueryMock.mockImplementation((name) => {
      switch (name) {
        case "projects:list":
          return [project];
        case "members:list":
          return [member];
        default:
          return undefined;
      }
    });
  });

  it.each([
    ["/", "タスク", "Issue"],
    ["/issues", "Issue", "タスク"],
  ] as const)(
    "現在地 %s では %s タブに aria-current=page が付く",
    (path, activeLabel, inactiveLabel) => {
      renderAppLayout([path]);

      expect(screen.getByRole("link", { name: activeLabel })).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(
        screen.getByRole("link", { name: inactiveLabel }),
      ).not.toHaveAttribute("aria-current", "page");
    },
  );
});

describe("AppLayout のプロジェクト select", () => {
  it("プロジェクト一覧を選択肢に表示し、先頭プロジェクトを選択値にする", () => {
    const projectA = createProject();
    const projectB = createProject({
      _id: "project_2" as Id<"projects">,
      key: "WEB",
      name: "Web サイト",
    });
    useQueryMock.mockImplementation((name) => {
      switch (name) {
        case "projects:list":
          return [projectA, projectB];
        case "members:list":
          return [createMember()];
        default:
          return undefined;
      }
    });
    renderAppLayout();

    const select = screen.getByRole("combobox", { name: "プロジェクト" });
    expect(select).toHaveValue(projectA._id);
    expect(
      screen.getByRole("option", { name: "TASK — タスク管理" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "WEB — Web サイト" }),
    ).toBeInTheDocument();
  });
});
