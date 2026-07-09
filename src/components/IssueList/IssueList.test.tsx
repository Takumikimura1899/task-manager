import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import type { IssueStatus } from "../../lib/issueMeta";
import skeletonStyles from "../Skeleton/Skeleton.module.css";
import { IssueList } from "./IssueList";

/**
 * Issue 一覧のローディング表示と空状態（Issue #29）を検証する。
 * - 読み込み中は全画面差し替えでなく、見出し＋スケルトン行を出す
 * - 0 件でも見出しごと消えず（従来は null 返却）、「＋ 新規 Issue」への
 *   誘導メッセージを出す
 * Convex（useQuery / useMutation）は外部依存のためモックする。
 */

const { issuesQuery } = vi.hoisted(() => ({
  issuesQuery: vi.fn<() => unknown>(),
}));

vi.mock("convex/react", () => ({
  useQuery: () => issuesQuery(),
  useMutation: () => vi.fn<() => Promise<unknown>>(),
}));

const createIssue = (overrides: Record<string, unknown> = {}) => ({
  _id: "issue_1" as Id<"issues">,
  number: 34,
  status: "open" as IssueStatus,
  title: "ログインできない問題を解決する",
  doneCount: 1,
  taskCount: 3,
  ...overrides,
});

const renderIssueList = () =>
  render(
    <MemoryRouter>
      <IssueList
        createdBy={"member_1" as Id<"members">}
        project={"project_1" as Id<"projects">}
        projectKey="TASK"
      />
    </MemoryRouter>,
  );

beforeEach(() => {
  issuesQuery.mockReset();
});

describe("IssueList のローディング表示", () => {
  it("読み込み中は見出しを維持したままスケルトン行を表示する", () => {
    issuesQuery.mockReturnValue(undefined);
    renderIssueList();

    const status = screen.getByRole("status", { name: "Issue を読み込み中" });
    expect(screen.getByRole("heading", { name: "Issue" })).toBeInTheDocument();
    expect(
      status.getElementsByClassName(skeletonStyles.skeleton).length,
    ).toBeGreaterThan(0);
  });
});

describe("IssueList の空状態", () => {
  it("0 件でも見出しを表示し、「＋ 新規 Issue」への誘導メッセージを出す", () => {
    issuesQuery.mockReturnValue([]);
    renderIssueList();

    expect(
      screen.getByRole("heading", { name: "Issue（0）" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Issue がありません。上の「＋ 新規 Issue」から作成してください。",
      ),
    ).toBeInTheDocument();
  });

  it("Issue があるときは誘導メッセージを出さず、一覧を表示する", () => {
    issuesQuery.mockReturnValue([createIssue()]);
    renderIssueList();

    expect(
      screen.getByRole("heading", { name: "Issue（1）" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "ログインできない問題を解決する" }),
    ).toHaveAttribute("href", "/TASK/issues/34");
    expect(screen.queryByText(/Issue がありません/)).not.toBeInTheDocument();
  });
});
