import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { TaskCard } from "./TaskCard";

/**
 * タスクカードの表示内容（参照番号リンク・タイトル・優先度・
 * 所属Issue・担当者の条件付き表示）を検証する。
 * Link を含むため MemoryRouter でラップしてレンダリングする。
 */

const createTask = (overrides: Partial<Doc<"tasks">> = {}): Doc<"tasks"> => ({
  _id: "task_1" as Id<"tasks">,
  _creationTime: 1000,
  issue: "issue_1" as Id<"issues">,
  project: "project_1" as Id<"projects">,
  number: 12,
  title: "ログイン不具合を修正する",
  status: "todo",
  priority: "high",
  rank: "a0",
  createdBy: "member_1" as Id<"members">,
  revision: 1,
  updatedAt: 1000,
  ...overrides,
});

const createProps = (
  overrides: Partial<Parameters<typeof TaskCard>[0]> = {},
) => ({
  task: createTask(),
  projectKey: "TASK",
  ...overrides,
});

const renderCard = (props = createProps()) =>
  render(
    <MemoryRouter>
      <TaskCard {...props} />
    </MemoryRouter>,
  );

describe("TaskCard", () => {
  it("参照番号がタスク詳細へのリンクになる", () => {
    renderCard();

    expect(screen.getByRole("link", { name: "TASK-12" })).toHaveAttribute(
      "href",
      "/TASK/tasks/12",
    );
  });

  it("タイトルを見出しとして表示する", () => {
    renderCard();

    expect(
      screen.getByRole("heading", { name: "ログイン不具合を修正する" }),
    ).toBeInTheDocument();
  });

  it.each([
    ["none", "優先度: なし"],
    ["low", "優先度: 低"],
    ["medium", "優先度: 中"],
    ["high", "優先度: 高"],
    ["urgent", "優先度: 緊急"],
  ] as const)("priority=%s のとき「%s」と表示する", (priority, expected) => {
    renderCard(createProps({ task: createTask({ priority }) }));

    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("issueNumber を渡すと所属 Issue を表示する", () => {
    renderCard(createProps({ issueNumber: 34 }));

    expect(screen.getByText("Issue #34")).toBeInTheDocument();
  });

  it("assigneeName を渡すと担当者名を表示する", () => {
    renderCard(createProps({ assigneeName: "Alice" }));

    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("issueNumber と assigneeName が未指定なら所属 Issue・担当者を表示しない", () => {
    renderCard();

    expect(screen.queryByText(/Issue #/)).not.toBeInTheDocument();
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
  });
});
