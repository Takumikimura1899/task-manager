import { render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import type { IssueSummary } from "../../lib/issueMeta";
import { IssuesView } from "./IssuesView";

/**
 * IssuesView は issues.list をこの1箇所だけで購読し、IssueStats /
 * NewIssueForm / IssueTable へ props で配る。ローディング表示・購読値の反映・
 * NewIssueForm の表示条件を検証する。
 * NoMembersNotice（currentMember が null のときの案内）は AppLayout 側に
 * 責務が一元化されているため、ここでは「IssuesView 自身は出さない」ことのみ
 * 確認する（表示内容自体の検証は AppLayout.test.tsx / NoMembersNotice.test.tsx）。
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
  assignees: [],
  ...overrides,
});

const renderIssuesView = (
  contextOverrides: {
    members?: Doc<"members">[] | undefined;
    currentMember?: Doc<"members"> | null;
    initialEntries?: string[];
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
    <MemoryRouter initialEntries={contextOverrides.initialEntries ?? ["/"]}>
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

  it("issues ロード中でも currentMember がいれば NewIssueForm を表示する", () => {
    renderIssuesView();

    expect(
      screen.getByRole("button", { name: "＋ Issue を作成" }),
    ).toBeInTheDocument();
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

describe("IssuesView の URL からのフィルタ復元（Issue #91）", () => {
  it("status クエリで指定したステータスの Issue のみ一覧に表示する", () => {
    mocks.issues = [
      createIssueSummary({
        _id: "issue_1" as Id<"issues">,
        number: 1,
        title: "未着手のIssue",
        status: "open",
      }),
      createIssueSummary({
        _id: "issue_2" as Id<"issues">,
        number: 2,
        title: "完了したIssue",
        status: "done",
      }),
    ];
    renderIssuesView({ initialEntries: ["/?status=done"] });

    expect(
      screen.getByRole("heading", { name: "Issue 一覧（1）" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "完了したIssue" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "未着手のIssue" }),
    ).not.toBeInTheDocument();
  });

  it("priority クエリで指定した優先度の Issue のみ一覧に表示する", () => {
    mocks.issues = [
      createIssueSummary({
        _id: "issue_1" as Id<"issues">,
        number: 1,
        title: "緊急のIssue",
        priority: "urgent",
      }),
      createIssueSummary({
        _id: "issue_2" as Id<"issues">,
        number: 2,
        title: "通常のIssue",
        priority: "none",
      }),
    ];
    renderIssuesView({ initialEntries: ["/?priority=urgent"] });

    expect(
      screen.getByRole("heading", { name: "Issue 一覧（1）" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "緊急のIssue" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "通常のIssue" }),
    ).not.toBeInTheDocument();
  });

  it("assignee クエリで指定した担当者を含む Issue のみ一覧に表示する", () => {
    mocks.issues = [
      createIssueSummary({
        _id: "issue_1" as Id<"issues">,
        number: 1,
        title: "member_1が担当のIssue",
        assignees: ["member_1" as Id<"members">],
      }),
      createIssueSummary({
        _id: "issue_2" as Id<"issues">,
        number: 2,
        title: "member_2が担当のIssue",
        assignees: ["member_2" as Id<"members">],
      }),
    ];
    renderIssuesView({ initialEntries: ["/?assignee=member_1"] });

    expect(
      screen.getByRole("heading", { name: "Issue 一覧（1）" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "member_1が担当のIssue" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "member_2が担当のIssue" }),
    ).not.toBeInTheDocument();
  });

  it("複数のクエリを同時指定すると暗黙 AND で絞り込む", () => {
    mocks.issues = [
      createIssueSummary({
        _id: "issue_1" as Id<"issues">,
        number: 1,
        title: "両条件に一致するIssue",
        status: "open",
        priority: "high",
      }),
      createIssueSummary({
        _id: "issue_2" as Id<"issues">,
        number: 2,
        title: "ステータスのみ一致するIssue",
        status: "open",
        priority: "none",
      }),
      createIssueSummary({
        _id: "issue_3" as Id<"issues">,
        number: 3,
        title: "優先度のみ一致するIssue",
        status: "done",
        priority: "high",
      }),
    ];
    renderIssuesView({ initialEntries: ["/?status=open&priority=high"] });

    expect(
      screen.getByRole("heading", { name: "Issue 一覧（1）" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "両条件に一致するIssue" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "ステータスのみ一致するIssue" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "優先度のみ一致するIssue" }),
    ).not.toBeInTheDocument();
  });

  it("フィルタ結果が0件の場合、IssueStats の総数はフィルタ前の件数を維持しつつ IssueTable は既存の空状態を表示する", () => {
    mocks.issues = [
      createIssueSummary({
        _id: "issue_1" as Id<"issues">,
        number: 1,
        title: "未着手のIssue",
        status: "open",
      }),
      createIssueSummary({
        _id: "issue_2" as Id<"issues">,
        number: 2,
        title: "完了したIssue",
        status: "done",
      }),
    ];
    renderIssuesView({ initialEntries: ["/?status=canceled"] });

    expect(screen.getByText("Issue 合計")).toHaveTextContent("Issue 合計 2");
    expect(
      screen.getByRole("heading", { name: "Issue 一覧（0）" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Issue がありません。")).toBeInTheDocument();
  });
});

describe("IssuesView の URL からのソート復元（Issue #93）", () => {
  it("sort=priority&dir=desc で優先度の高い順（urgent→high→none）に並べる（文字列比較では壊れる順序）", () => {
    mocks.issues = [
      createIssueSummary({
        _id: "issue_1" as Id<"issues">,
        number: 1,
        title: "noneのIssue",
        priority: "none",
      }),
      createIssueSummary({
        _id: "issue_2" as Id<"issues">,
        number: 2,
        title: "urgentのIssue",
        priority: "urgent",
      }),
      createIssueSummary({
        _id: "issue_3" as Id<"issues">,
        number: 3,
        title: "highのIssue",
        priority: "high",
      }),
    ];
    renderIssuesView({ initialEntries: ["/?sort=priority&dir=desc"] });

    // IssueTable の行タイトルリンクのみが link ロールを持つ（他に link は無い）。
    const links = screen.getAllByRole("link");
    expect(links.map((el) => el.textContent)).toEqual([
      "urgentのIssue",
      "highのIssue",
      "noneのIssue",
    ]);
  });

  it("sort=priority&dir=asc で優先度の低い順（none→high→urgent）に並べる", () => {
    mocks.issues = [
      createIssueSummary({
        _id: "issue_1" as Id<"issues">,
        number: 1,
        title: "urgentのIssue",
        priority: "urgent",
      }),
      createIssueSummary({
        _id: "issue_2" as Id<"issues">,
        number: 2,
        title: "noneのIssue",
        priority: "none",
      }),
      createIssueSummary({
        _id: "issue_3" as Id<"issues">,
        number: 3,
        title: "highのIssue",
        priority: "high",
      }),
    ];
    renderIssuesView({ initialEntries: ["/?sort=priority&dir=asc"] });

    // IssueTable の行タイトルリンクのみが link ロールを持つ（他に link は無い）。
    const links = screen.getAllByRole("link");
    expect(links.map((el) => el.textContent)).toEqual([
      "noneのIssue",
      "highのIssue",
      "urgentのIssue",
    ]);
  });

  it("sort=updatedAt&dir=desc で更新が新しい順に並べる", () => {
    mocks.issues = [
      createIssueSummary({
        _id: "issue_1" as Id<"issues">,
        number: 1,
        title: "古いIssue",
        updatedAt: 1000,
      }),
      createIssueSummary({
        _id: "issue_2" as Id<"issues">,
        number: 2,
        title: "新しいIssue",
        updatedAt: 3000,
      }),
      createIssueSummary({
        _id: "issue_3" as Id<"issues">,
        number: 3,
        title: "中間のIssue",
        updatedAt: 2000,
      }),
    ];
    renderIssuesView({ initialEntries: ["/?sort=updatedAt&dir=desc"] });

    // IssueTable の行タイトルリンクのみが link ロールを持つ（他に link は無い）。
    const links = screen.getAllByRole("link");
    expect(links.map((el) => el.textContent)).toEqual([
      "新しいIssue",
      "中間のIssue",
      "古いIssue",
    ]);
  });

  it("sort=updatedAt&dir=asc で更新が古い順に並べる", () => {
    mocks.issues = [
      createIssueSummary({
        _id: "issue_1" as Id<"issues">,
        number: 1,
        title: "新しいIssue",
        updatedAt: 3000,
      }),
      createIssueSummary({
        _id: "issue_2" as Id<"issues">,
        number: 2,
        title: "古いIssue",
        updatedAt: 1000,
      }),
      createIssueSummary({
        _id: "issue_3" as Id<"issues">,
        number: 3,
        title: "中間のIssue",
        updatedAt: 2000,
      }),
    ];
    renderIssuesView({ initialEntries: ["/?sort=updatedAt&dir=asc"] });

    // IssueTable の行タイトルリンクのみが link ロールを持つ（他に link は無い）。
    const links = screen.getAllByRole("link");
    expect(links.map((el) => el.textContent)).toEqual([
      "古いIssue",
      "中間のIssue",
      "新しいIssue",
    ]);
  });

  it("sort 無指定の場合はサーバー返却順（issues.list の順序）を維持する", () => {
    mocks.issues = [
      createIssueSummary({
        _id: "issue_1" as Id<"issues">,
        number: 1,
        title: "2番目に返るIssue",
        priority: "urgent",
        updatedAt: 3000,
      }),
      createIssueSummary({
        _id: "issue_2" as Id<"issues">,
        number: 2,
        title: "1番目に返るIssue",
        priority: "none",
        updatedAt: 1000,
      }),
    ];
    renderIssuesView();

    // IssueTable の行タイトルリンクのみが link ロールを持つ（他に link は無い）。
    const links = screen.getAllByRole("link");
    expect(links.map((el) => el.textContent)).toEqual([
      "2番目に返るIssue",
      "1番目に返るIssue",
    ]);
  });

  it("フィルタ（status=open）とソート（priority降順）を併用すると、フィルタ後の集合に対してソートが独立に機能する", () => {
    mocks.issues = [
      createIssueSummary({
        _id: "issue_1" as Id<"issues">,
        number: 1,
        title: "openかつnoneのIssue",
        status: "open",
        priority: "none",
      }),
      createIssueSummary({
        _id: "issue_2" as Id<"issues">,
        number: 2,
        title: "doneかつurgentのIssue",
        status: "done",
        priority: "urgent",
      }),
      createIssueSummary({
        _id: "issue_3" as Id<"issues">,
        number: 3,
        title: "openかつurgentのIssue",
        status: "open",
        priority: "urgent",
      }),
    ];
    renderIssuesView({
      initialEntries: ["/?status=open&sort=priority&dir=desc"],
    });

    expect(
      screen.getByRole("heading", { name: "Issue 一覧（2）" }),
    ).toBeInTheDocument();
    // IssueTable の行タイトルリンクのみが link ロールを持つ（他に link は無い）。
    const links = screen.getAllByRole("link");
    expect(links.map((el) => el.textContent)).toEqual([
      "openかつurgentのIssue",
      "openかつnoneのIssue",
    ]);
  });
});

describe("IssuesView の NewIssueForm 表示条件", () => {
  it("currentMember が null の場合は NewIssueForm を表示しない（NoMembersNotice も出さない）", () => {
    mocks.issues = [];
    renderIssuesView({ currentMember: null, members: [] });

    expect(
      screen.queryByRole("button", { name: "＋ Issue を作成" }),
    ).not.toBeInTheDocument();
    // NoMembersNotice は AppLayout 側に責務が一元化されたため、IssuesView 自身は出さない
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("currentMember がいる場合は NewIssueForm を表示する", () => {
    mocks.issues = [];
    renderIssuesView();

    expect(
      screen.getByRole("button", { name: "＋ Issue を作成" }),
    ).toBeInTheDocument();
  });
});
