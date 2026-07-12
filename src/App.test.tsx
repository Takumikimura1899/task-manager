import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { App } from "./App";

/**
 * ルーティングのフォールバック（path="*"、Issue #16）と /issues ルートの
 * マウントを検証する。
 *
 * 未知 URL では NotFound だけがマウントされ Convex の useQuery を呼ぶ
 * コンポーネントは描画されないため、モック無しでもテストできる（既存ケース）。
 * 一方 "/" と "/issues" は AppLayout（レイアウトルート）配下にマウントされ、
 * AppLayout 自身が projects.list / members.list を購読するため、convex/react
 * のモックが必要になる。api の関数参照（anyApi）は参照同一性を持たないため、
 * getFunctionName で "module:function" 名に解決してディスパッチする
 * （AppLayout.test.tsx と同方式）。NotFound ケースへの影響はない
 * （NotFound は Convex の hooks を呼ばない）。
 * 既存ルート（TasksView / 詳細画面）の描画内容は各画面のテストに委ねる。
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

beforeEach(() => {
  useQueryMock.mockReset();
  mutate.mockReset();
  sessionStorage.clear();
});

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

describe("App の /issues ルート", () => {
  it("/issues では AppLayout 配下に IssuesView（Issue 一覧）をマウントする", () => {
    const project = {
      _id: "project_1" as Id<"projects">,
      _creationTime: 1000,
      key: "TASK",
      name: "タスク管理",
      nextTaskNumber: 1,
      nextIssueNumber: 1,
    } as Doc<"projects">;
    const member = {
      _id: "member_1" as Id<"members">,
      _creationTime: 1000,
      name: "Alice",
      email: "alice@example.com",
      role: "member",
    } as Doc<"members">;
    useQueryMock.mockImplementation((name) => {
      switch (name) {
        case "projects:list":
          return [project];
        case "members:list":
          return [member];
        case "issues:list":
          return [];
        default:
          return undefined;
      }
    });

    render(
      <MemoryRouter initialEntries={["/issues"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Issue" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("heading", { name: "Issue 一覧（0）" }),
    ).toBeInTheDocument();
  });
});
