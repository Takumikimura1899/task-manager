import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { ActiveIssueStrip } from "./ActiveIssueStrip";

/**
 * ActiveIssueStrip は進行中（in_progress）Issue だけをチップで示す帯。
 * ローディング（Skeleton）・in_progress 以外を除外する絞り込み・0件時の
 * 案内文・リンク先を検証する。Convex（useQuery）は外部依存のためモックする。
 */

const mocks = vi.hoisted(() => ({
  issues: undefined as unknown,
}));

vi.mock("convex/react", () => ({
  useQuery: () => mocks.issues,
}));

const createIssueSummary = (overrides: Record<string, unknown> = {}) => ({
  _id: "issue_1" as Id<"issues">,
  _creationTime: 1000,
  project: "project_1" as Id<"projects">,
  number: 12,
  title: "ログイン機能を実装する",
  createdBy: "member_1" as Id<"members">,
  priority: "none",
  revision: 1,
  updatedAt: 1000,
  status: "in_progress",
  taskCount: 3,
  doneCount: 1,
  estimateTotal: 5,
  actualTotal: 2,
  ...overrides,
});

const renderStrip = (
  project: Id<"projects"> = "project_1" as Id<"projects">,
  projectKey = "TASK",
) =>
  render(
    <MemoryRouter>
      <ActiveIssueStrip project={project} projectKey={projectKey} />
    </MemoryRouter>,
  );

beforeEach(() => {
  mocks.issues = undefined;
});

describe("ActiveIssueStrip のローディング表示", () => {
  it("読み込み中はスケルトンを表示する", () => {
    renderStrip();

    expect(
      screen.getByRole("status", { name: "進行中の Issue を読み込み中" }),
    ).toBeInTheDocument();
  });
});

describe("ActiveIssueStrip の絞り込みとリンク", () => {
  it("in_progress の Issue だけをチップ表示し、他ステータスは表示しない", () => {
    mocks.issues = [
      createIssueSummary({
        _id: "issue_open",
        number: 1,
        title: "未着手のIssue",
        status: "open",
      }),
      createIssueSummary({
        _id: "issue_active",
        number: 12,
        title: "ログイン機能を実装する",
        status: "in_progress",
        taskCount: 3,
        doneCount: 1,
      }),
      createIssueSummary({
        _id: "issue_done",
        number: 3,
        title: "完了済みのIssue",
        status: "done",
      }),
      createIssueSummary({
        _id: "issue_canceled",
        number: 4,
        title: "中止されたIssue",
        status: "canceled",
      }),
    ];
    renderStrip();

    const link = screen.getByRole("link", { name: /ログイン機能を実装する/ });
    expect(link).toHaveAttribute("href", "/TASK/issues/12");
    expect(link).toHaveTextContent("TASK#12");
    expect(link).toHaveTextContent("1/3");

    expect(screen.queryByText("未着手のIssue")).not.toBeInTheDocument();
    expect(screen.queryByText("完了済みのIssue")).not.toBeInTheDocument();
    expect(screen.queryByText("中止されたIssue")).not.toBeInTheDocument();
  });

  it("in_progress の Issue が無い場合は案内文を表示する", () => {
    mocks.issues = [createIssueSummary({ status: "open" })];
    renderStrip();

    expect(
      screen.getByText("進行中の Issue はありません。"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
