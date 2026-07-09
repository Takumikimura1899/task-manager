import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { NewIssueForm } from "./NewIssueForm";

/**
 * Issue 作成フォームのアクセシビリティ（Issue #27）を検証する。
 * 2つのタイトル入力がアクセシブルネームで取得でき、送信失敗時のエラーが
 * role="alert" で SR に通知され、両入力へ aria-describedby で紐付くこと。
 * Convex（useMutation / useQuery）は外部依存のためモックする。
 */

const { createIssue, members } = vi.hoisted(() => ({
  createIssue: vi.fn<(args: unknown) => Promise<unknown>>(),
  members: [{ _id: "member_1", name: "Alice" }],
}));

vi.mock("convex/react", () => ({
  useMutation: () => createIssue,
  useQuery: () => members,
}));

const createProps = (
  overrides: Partial<Parameters<typeof NewIssueForm>[0]> = {},
) => ({
  project: "project_1" as Id<"projects">,
  createdBy: "member_1" as Id<"members">,
  ...overrides,
});

const openForm = async (user: ReturnType<typeof userEvent.setup>) => {
  render(<NewIssueForm {...createProps()} />);
  await user.click(screen.getByRole("button", { name: "＋ 新規 Issue" }));
};

beforeEach(() => {
  createIssue.mockReset();
  createIssue.mockResolvedValue(undefined);
});

describe("NewIssueForm", () => {
  it("Issue タイトル・最初のタスクタイトルの入力がアクセシブルネームで取得できる", async () => {
    const user = userEvent.setup();
    await openForm(user);

    expect(screen.getByLabelText("Issue のタイトル")).toBeInTheDocument();
    expect(screen.getByLabelText("最初のタスクのタイトル")).toBeInTheDocument();
    expect(screen.getByLabelText("優先度")).toBeInTheDocument();
    expect(screen.getByLabelText("担当者")).toBeInTheDocument();
  });

  it("送信失敗時はエラーが role=alert で通知され、両方の入力に aria-describedby で紐付く", async () => {
    createIssue.mockRejectedValue(new Error("network error"));
    const user = userEvent.setup();
    await openForm(user);

    await user.type(
      screen.getByLabelText("Issue のタイトル"),
      "ログインできない",
    );
    await user.type(
      screen.getByLabelText("最初のタスクのタイトル"),
      "原因を調査する",
    );
    await user.click(screen.getByRole("button", { name: "作成" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("作成に失敗しました");
    const errorId = alert.getAttribute("id");
    expect(screen.getByLabelText("Issue のタイトル")).toHaveAttribute(
      "aria-describedby",
      errorId,
    );
    expect(screen.getByLabelText("最初のタスクのタイトル")).toHaveAttribute(
      "aria-describedby",
      errorId,
    );
  });

  it("エラーが無い間は入力に aria-describedby を付けない", async () => {
    const user = userEvent.setup();
    await openForm(user);

    expect(screen.getByLabelText("Issue のタイトル")).not.toHaveAttribute(
      "aria-describedby",
    );
  });
});
