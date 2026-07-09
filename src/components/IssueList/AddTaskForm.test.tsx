import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { AddTaskForm } from "./AddTaskForm";

/**
 * タスク追加フォームのアクセシビリティ（Issue #27）を検証する。
 * 入力・select がアクセシブルネームで取得でき、送信失敗時のエラーが
 * role="alert" で SR に通知され、入力へ aria-describedby で紐付くこと。
 * Convex（useMutation / useQuery）は外部依存のためモックする。
 */

const { createTask, members } = vi.hoisted(() => ({
  createTask: vi.fn<(args: unknown) => Promise<unknown>>(),
  members: [{ _id: "member_1", name: "Alice" }],
}));

vi.mock("convex/react", () => ({
  useMutation: () => createTask,
  useQuery: () => members,
}));

const createProps = (
  overrides: Partial<Parameters<typeof AddTaskForm>[0]> = {},
) => ({
  issue: "issue_1" as Id<"issues">,
  createdBy: "member_1" as Id<"members">,
  ...overrides,
});

const openForm = async (user: ReturnType<typeof userEvent.setup>) => {
  render(<AddTaskForm {...createProps()} />);
  await user.click(screen.getByRole("button", { name: "＋ タスク" }));
};

beforeEach(() => {
  createTask.mockReset();
  createTask.mockResolvedValue(undefined);
});

describe("AddTaskForm", () => {
  it("タイトル入力と優先度・担当者の select がアクセシブルネームで取得できる", async () => {
    const user = userEvent.setup();
    await openForm(user);

    expect(screen.getByLabelText("タスクのタイトル")).toBeInTheDocument();
    expect(screen.getByLabelText("優先度")).toBeInTheDocument();
    expect(screen.getByLabelText("担当者")).toBeInTheDocument();
  });

  it("送信失敗時はエラーが role=alert で通知され、タイトル入力に aria-describedby で紐付く", async () => {
    createTask.mockRejectedValue(new Error("network error"));
    const user = userEvent.setup();
    await openForm(user);

    await user.type(screen.getByLabelText("タスクのタイトル"), "バグを直す");
    await user.click(screen.getByRole("button", { name: "追加" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("追加に失敗しました");
    expect(screen.getByLabelText("タスクのタイトル")).toHaveAttribute(
      "aria-describedby",
      alert.getAttribute("id"),
    );
  });

  it("エラーが無い間はタイトル入力に aria-describedby を付けない", async () => {
    const user = userEvent.setup();
    await openForm(user);

    expect(screen.getByLabelText("タスクのタイトル")).not.toHaveAttribute(
      "aria-describedby",
    );
  });
});
