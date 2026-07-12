import { render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import type { IssueSummary } from "../../lib/issueMeta";
import { IssuesView } from "./IssuesView";

/**
 * IssuesView は issues.list をこの1箇所だけで購読し、IssueStats /
 * NewIssueForm（または NoMembersNotice）/ IssueTable へ props で配る。
 * ローディング表示・購読値の反映・メンバー0件時の分岐を検証する。
 * Convex（useQuery / useMutation）は外部依存のためモックし、
 * useAppOutletContext（useOutletContext）は実物の <Outlet context> 経由で
 * 値を注入する（AppLayout 自体の実装には依存しない）。
 */

const mocks = vi.hoisted(() => ({
  issues: undefined as unknown,
  mutate: vi.fn<(args: unknown) => Promise<unknown>>(),
}));

vi.mock("convex/react", () => ({
  useQuery: () => mocks.issues,
  useMutation: () => mocks.mutate,
}));

const project = {
  _id: "project_1" as Id<"projects">,
  _creationTime: 1000,
  key: "TASK",
  name: "タスク管理",
  nextTaskNumber: 1,
  nextIssueNumber: 1,
} as Doc<"projects">;

const createMember = (overrides: Record<string, unknown> = {}) =>
  ({
    _id: "member_1" as Id<"members">,
    _creationTime: 1000,
    name: "Alice",
    email: "alice@example.com",
    role: "member",
    ...overrides,
  }) as Doc<"members">;

const createIssueSummary = (
  overrides: Partial<IssueSummary> = {},
): IssueSummary => ({
  _id: "issue_1" as Id<"issues">,
  _creationTime: 1000,
  project: project._id,
  number: 1,
  title: "Issue",
  createdBy: "member_1" as Id<"members">,
  priority: "none",
  revision: 1,
  updatedAt: 1000,
  status: "open",
  taskCount: 1,
  doneCount: 0,
  estimateTotal: 0,
  actualTotal: 0,
  ...overrides,
});

const renderIssuesView = (
  contextOverrides: {
    members?: Doc<"members">[] | undefined;
    currentMember?: Doc<"members"> | null;
  } = {},
) => {
  const context = {
    projects: [project],
    selected: project,
    members: contextOverrides.members ?? [createMember()],
    currentMember:
      contextOverrides.currentMember !== undefined
        ? contextOverrides.currentMember
        : createMember(),
  };
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<Outlet context={context} />}>
          <Route element={<IssuesView />} path="/" />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  mocks.issues = undefined;
  mocks.mutate.mockReset();
  mocks.mutate.mockResolvedValue(undefined);
});

describe("IssuesView のローディング表示", () => {
  it("読み込み中は Issue を読み込み中のスケルトンを表示し、一覧は出さない", () => {
    renderIssuesView();

    expect(
      screen.getByRole("status", { name: "Issue を読み込み中" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /Issue 一覧/ }),
    ).not.toBeInTheDocument();
  });
});

describe("IssuesView の購読値の反映", () => {
  it("issues を IssueStats（総数）と IssueTable（一覧）の両方へ反映する", () => {
    mocks.issues = [
      createIssueSummary({
        _id: "issue_1" as Id<"issues">,
        number: 1,
        title: "ログイン機能を実装する",
        status: "open",
      }),
      createIssueSummary({
        _id: "issue_2" as Id<"issues">,
        number: 2,
        title: "決済機能を実装する",
        status: "done",
      }),
    ];
    renderIssuesView();

    expect(screen.getByText("Issue 合計")).toHaveTextContent("Issue 合計 2");
    expect(
      screen.getByRole("heading", { name: "Issue 一覧（2）" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "ログイン機能を実装する" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "決済機能を実装する" }),
    ).toBeInTheDocument();
  });
});

describe("IssuesView のメンバー0件分岐", () => {
  it("currentMember が null かつ members 取得済みなら NoMembersNotice を表示する", () => {
    mocks.issues = [];
    renderIssuesView({ currentMember: null, members: [] });

    expect(screen.getByRole("note")).toHaveTextContent(
      "メンバーが登録されていない",
    );
    expect(
      screen.queryByRole("button", { name: "＋ 新規 Issue" }),
    ).not.toBeInTheDocument();
  });

  it("currentMember がいる場合は NewIssueForm を表示し、NoMembersNotice は出さない", () => {
    mocks.issues = [];
    renderIssuesView();

    expect(
      screen.getByRole("button", { name: "＋ 新規 Issue" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});
