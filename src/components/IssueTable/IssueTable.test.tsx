import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { ISSUE_STATUS_LABELS, type IssueSummary } from "../../lib/issueMeta";
import { PRIORITY_LABELS } from "../../lib/taskMeta";
import { IssueTable } from "./IssueTable";

/**
 * IssueTable は issues.list の購読値を props で受け取り指標付きで表示するだけの
 * 表示コンポーネント（削除導線は Issue 詳細の danger セクションに一本化済み、
 * #105）。行内容（参照・ステータス・タイトルリンク・優先度・進捗・工数）を検証する。
 */

const createIssueSummary = (
  overrides: Partial<IssueSummary> = {},
): IssueSummary => ({
  _id: "issue_1" as Id<"issues">,
  _creationTime: 1000,
  project: "project_1" as Id<"projects">,
  number: 34,
  title: "ログイン機能を実装する",
  createdBy: "member_1" as Id<"members">,
  priority: "high",
  revision: 4,
  updatedAt: 1000,
  status: "in_progress",
  taskCount: 4,
  doneCount: 1,
  estimateTotal: 8,
  actualTotal: 0,
  assignees: [],
  ...overrides,
});

const renderTable = (issues: readonly IssueSummary[], projectKey = "TASK") =>
  render(
    <MemoryRouter>
      <IssueTable issues={issues} projectKey={projectKey} />
    </MemoryRouter>,
  );

describe("IssueTable の空状態", () => {
  it("Issue が0件のときは一覧表を出さず案内文を表示する", () => {
    renderTable([]);

    expect(
      screen.getByRole("heading", { name: "Issue 一覧（0）" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Issue がありません。")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("IssueTable の行内容", () => {
  it("参照・ステータス・タイトルリンク・優先度を表示する", () => {
    renderTable([
      createIssueSummary({
        number: 34,
        title: "ログイン機能を実装する",
        status: "in_progress",
        priority: "high",
      }),
    ]);

    expect(screen.getByText("Issue #34")).toBeInTheDocument();
    expect(
      screen.getByText(ISSUE_STATUS_LABELS.in_progress),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "ログイン機能を実装する" }),
    ).toHaveAttribute("href", "/TASK/issues/34");
    expect(screen.getByText(PRIORITY_LABELS.high)).toBeInTheDocument();
  });

  it("Task 進捗を progress バーと件数テキストで表示する", () => {
    renderTable([createIssueSummary({ taskCount: 4, doneCount: 1 })]);

    const progress = screen.getByRole("progressbar", {
      name: "Task 進捗 1/4",
    });
    expect(progress).toHaveAttribute("value", "25");
    expect(screen.getByText("1/4")).toBeInTheDocument();
  });

  it("タスクが0件のときは進捗0%（0/0）を表示する", () => {
    renderTable([createIssueSummary({ taskCount: 0, doneCount: 0 })]);

    const progress = screen.getByRole("progressbar", {
      name: "Task 進捗 0/0",
    });
    expect(progress).toHaveAttribute("value", "0");
  });

  // 合計 0 は「未入力」と区別できないため、予想・実績とも "—" 表示に統一。
  // 合計は浮動小数点の生値で届くため、表示は formatHoursTotal で丸める。
  // 丸めて 0 になる極小値（バックエンドは 0.001 等も許容）も "—" に統一され、
  // 「0h」と「未入力」の矛盾表示が起きないことを含めて検証する。
  it.each([
    { estimateTotal: 8, actualTotal: 0, estimateText: "8h", actualText: "—" },
    {
      estimateTotal: 0,
      actualTotal: 5,
      estimateText: "—",
      actualText: "5h",
    },
    {
      estimateTotal: 1.1 + 2.2, // 3.3000000000000003
      actualTotal: 0.1 + 0.2, // 0.30000000000000004
      estimateText: "3.3h",
      actualText: "0.3h",
    },
    {
      estimateTotal: 0.004, // 丸めると 0 になる極小値
      actualTotal: 0.005, // 丸めても 0 にならない境界値
      estimateText: "—",
      actualText: "0.01h",
    },
  ])(
    "予想 $estimateTotal / 実績 $actualTotal 時間を表示する",
    ({ estimateTotal, actualTotal, estimateText, actualText }) => {
      renderTable([createIssueSummary({ estimateTotal, actualTotal })]);

      expect(screen.getByText(estimateText)).toBeInTheDocument();
      expect(screen.getByText(actualText)).toBeInTheDocument();
    },
  );
});
