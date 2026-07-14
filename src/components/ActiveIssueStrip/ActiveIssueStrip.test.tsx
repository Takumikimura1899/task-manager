import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { ActiveIssueStrip } from "./ActiveIssueStrip";

/**
 * ActiveIssueStrip は issues.listInProgress（サーバー側で in_progress に
 * 絞り込み済み・最小フィールドのみ）を購読し、チップで示す帯。
 * ローディング（Skeleton）・返ってきた Issue をそのまま表示すること・0件時の
 * 案内文・リンク先を検証する。Convex（useQuery）は外部依存のためモックする。
 */

const mocks = vi.hoisted(() => ({
  issues: undefined as unknown,
}));

vi.mock("convex/react", () => ({
  useQuery: () => mocks.issues,
}));

/** listInProgress が返す最小フィールドのみを持つファクトリ。 */
const createIssueSummary = (overrides: Record<string, unknown> = {}) => ({
  _id: "issue_1" as Id<"issues">,
  number: 12,
  title: "ログイン機能を実装する",
  taskCount: 3,
  doneCount: 1,
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

describe("ActiveIssueStrip の表示とリンク", () => {
  it("listInProgress が返した Issue をそのままチップ表示する（絞り込みはサーバー側で完結）", () => {
    mocks.issues = [
      createIssueSummary({
        _id: "issue_active_1",
        number: 12,
        title: "ログイン機能を実装する",
        taskCount: 3,
        doneCount: 1,
      }),
      createIssueSummary({
        _id: "issue_active_2",
        number: 7,
        title: "決済フローを見直す",
        taskCount: 2,
        doneCount: 0,
      }),
    ];
    renderStrip();

    const link = screen.getByRole("link", { name: /ログイン機能を実装する/ });
    expect(link).toHaveAttribute("href", "/TASK/issues/12");
    expect(link).toHaveTextContent("Issue #12");
    expect(link).toHaveTextContent("1/3");

    const other = screen.getByRole("link", { name: /決済フローを見直す/ });
    expect(other).toHaveAttribute("href", "/TASK/issues/7");
    expect(other).toHaveTextContent("Issue #7");
    expect(other).toHaveTextContent("0/2");
  });

  it("in_progress の Issue が無い場合は案内文を表示する", () => {
    mocks.issues = [];
    renderStrip();

    expect(
      screen.getByText("進行中の Issue はありません。"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
