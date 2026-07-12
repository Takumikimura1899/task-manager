import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMember,
  createProject,
  createQueryDispatcher,
  type MutateMock,
  type QueryMock,
} from "../test/reactQuerySupport";
import { App } from "./App";

/**
 * ルーティングのフォールバック（path="*"、Issue #16）と /issues ルートの
 * マウントを検証する。
 *
 * 未知 URL では NotFound だけがマウントされ Convex の useQuery を呼ぶ
 * コンポーネントは描画されないため、モック無しでもテストできる（既存ケース）。
 * 一方 "/" と "/issues" は AppLayout（レイアウトルート）配下にマウントされ、
 * AppLayout 自身が projects.list / members.list を購読するため、convex/react
 * のモックが必要になる（ディスパッチの詳細は test/reactQuerySupport.ts 参照）。
 * NotFound ケースへの影響はない（NotFound は Convex の hooks を呼ばない）。
 * 既存ルート（TasksView / 詳細画面）の描画内容は各画面のテストに委ねる。
 */

const { useQueryMock, mutate } = vi.hoisted(() => ({
  useQueryMock: vi.fn<QueryMock>(),
  mutate: vi.fn<MutateMock>(),
}));

vi.mock("convex/react", async () => {
  const { buildConvexReactMock } = await import("../test/reactQuerySupport");
  return buildConvexReactMock(useQueryMock, mutate);
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
    const project = createProject();
    const member = createMember();
    useQueryMock.mockImplementation(
      createQueryDispatcher({
        "projects:list": [project],
        "members:list": [member],
        "issues:list": [],
      }),
    );

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
