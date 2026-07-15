import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import type { BoardTask } from "../../lib/board";
import { SortableTaskCard } from "./SortableTaskCard";

/**
 * D&D ラッパーのアクセシビリティ（Issue #27）を検証する。
 * 詳細画面へのリンク（anchor）とドラッグハンドル（button）が別要素として
 * 分離され、role="button" が anchor を内包する不正な入れ子が無いこと。
 */

const createTask = (overrides: Partial<BoardTask> = {}): BoardTask => ({
  _id: "task_1" as Id<"tasks">,
  _creationTime: 1000,
  issue: "issue_1" as Id<"issues">,
  project: "project_1" as Id<"projects">,
  number: 12,
  title: "ログイン不具合を修正する",
  status: "todo" as Doc<"tasks">["status"],
  priority: "high" as Doc<"tasks">["priority"],
  rank: "a0",
  createdBy: "member_1" as Id<"members">,
  revision: 1,
  updatedAt: 1000,
  issueNumber: 34,
  assigneeName: "Alice",
  ...overrides,
});

const renderSortableCard = (task = createTask()) =>
  render(
    <MemoryRouter>
      <DndContext>
        <SortableContext items={[task._id]}>
          <SortableTaskCard dragLocked={false} projectKey="TASK" task={task} />
        </SortableContext>
      </DndContext>
    </MemoryRouter>,
  );

describe("SortableTaskCard", () => {
  it("詳細リンクとドラッグハンドルを別要素として持ち、互いに入れ子にならない", () => {
    renderSortableCard();

    const link = screen.getByRole("link", { name: "TASK-12" });
    const handle = screen.getByRole("button", { name: "TASK-12 を移動" });

    expect(link).toHaveAttribute("href", "/TASK/tasks/12");
    expect(link).not.toContainElement(handle);
    expect(handle).not.toContainElement(link);
  });

  it("ドラッグハンドルは native button で、D&D のキーボード起点になる", () => {
    renderSortableCard();

    const handle = screen.getByRole("button", { name: "TASK-12 を移動" });

    expect(handle.tagName).toBe("BUTTON");
    // KeyboardSensor のアクティベータとして dnd-kit の説明文が紐付く
    expect(handle).toHaveAttribute("aria-describedby");
    expect(handle).toHaveAttribute("aria-roledescription", "sortable");
  });

  it("Tab でリンク → ハンドルの順にフォーカスが移り、タブストップは2つに分離される", async () => {
    const user = userEvent.setup();
    renderSortableCard();

    await user.tab();
    expect(screen.getByRole("link", { name: "TASK-12" })).toHaveFocus();

    await user.tab();
    expect(
      screen.getByRole("button", { name: "TASK-12 を移動" }),
    ).toHaveFocus();
  });
});
