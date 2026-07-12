import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { ISSUE_STATUS_LABELS, type IssueSummary } from "../../lib/issueMeta";
import { IssueStats } from "./IssueStats";

/**
 * IssueStats は issues.list の購読値を props で受け取って集計するだけの
 * 純表示コンポーネント（Convex 依存なし）。合計件数とステータス別件数を検証する。
 */

const createIssueSummary = (
  overrides: Partial<IssueSummary> = {},
): IssueSummary => ({
  _id: "issue_1" as Id<"issues">,
  _creationTime: 1000,
  project: "project_1" as Id<"projects">,
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

describe("IssueStats", () => {
  const issues = [
    createIssueSummary({ status: "open" }),
    createIssueSummary({ status: "open" }),
    createIssueSummary({ status: "in_progress" }),
    createIssueSummary({ status: "done" }),
    createIssueSummary({ status: "done" }),
    createIssueSummary({ status: "done" }),
    createIssueSummary({ status: "canceled" }),
  ];

  it("Issue の総数を表示する", () => {
    render(<IssueStats issues={issues} />);

    expect(screen.getByText("Issue 合計")).toHaveTextContent("Issue 合計 7");
  });

  it.each([
    ["open", 2],
    ["in_progress", 1],
    ["done", 3],
    ["canceled", 1],
  ] as const)("%s ステータスの件数を %i 件と表示する", (status, count) => {
    render(<IssueStats issues={issues} />);

    const badge = screen.getByText(ISSUE_STATUS_LABELS[status]);
    const item = badge.closest("li");
    expect(item).not.toBeNull();
    expect(
      within(item as HTMLElement).getByText(String(count)),
    ).toBeInTheDocument();
  });

  it("Issue が0件でも総数0とステータス別0件を表示する", () => {
    render(<IssueStats issues={[]} />);

    expect(screen.getByText("Issue 合計")).toHaveTextContent("Issue 合計 0");
    for (const label of Object.values(ISSUE_STATUS_LABELS)) {
      const item = screen.getByText(label).closest("li");
      expect(item).not.toBeNull();
      expect(within(item as HTMLElement).getByText("0")).toBeInTheDocument();
    }
  });
});
