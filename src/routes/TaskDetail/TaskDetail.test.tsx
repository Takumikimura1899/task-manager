import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskDetail } from "./TaskDetail";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * Task 詳細のローディング表示（Issue #29）と編集操作（Issue #32:
 * ステータス遷移・破壊的操作の確認・削除）を検証する。
 * Convex は外部依存のためモックする。getDetail は引数付き・members.list は
 * 引数なしで呼ばれる性質を使って購読値を出し分ける。
 */

const mocks = vi.hoisted(() => ({
  task: undefined as unknown,
  members: [] as unknown,
  mutate: vi.fn<(args: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock("convex/react", () => ({
  useQuery: (_query: unknown, args?: unknown) =>
    args === undefined ? mocks.members : mocks.task,
  useMutation: () => mocks.mutate,
}));

const createTask = (overrides: Record<string, unknown> = {}) => ({
  _id: "task1",
  _creationTime: 1751900000000,
  revision: 5,
  projectKey: "TASK",
  number: 12,
  title: "認証APIの実装",
  description: "JWT の発行と検証",
  priority: "high",
  status: "in_review",
  assignee: null,
  issueNumber: 1,
  issueTitle: "ログイン機能を実装する",
  createdByName: "木村",
  updatedAt: 1751900000000,
  gitLinks: [],
  ...overrides,
});

const renderTaskDetail = () =>
  render(
    <MemoryRouter initialEntries={["/TASK/tasks/12"]}>
      <Routes>
        <Route element={<p>一覧画面</p>} path="/" />
        <Route element={<TaskDetail />} path="/:projectKey/tasks/:number" />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  mocks.task = undefined;
  mocks.members = [];
  mocks.mutate.mockReset();
  mocks.mutate.mockResolvedValue(undefined);
});

describe("TaskDetail のローディング表示", () => {
  it("読み込み中も戻り導線を維持したままスケルトンを表示する", () => {
    renderTaskDetail();

    expect(
      screen.getByRole("status", { name: "タスクを読み込み中" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← 一覧へ" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});

describe("TaskDetail の編集操作（Issue #32）", () => {
  it("編集ボタンで現在値（優先度含む）が入ったフォームを開き、保存で最新 revision を添えて更新する", async () => {
    const user = userEvent.setup();
    mocks.task = createTask();
    renderTaskDetail();

    await user.click(screen.getByRole("button", { name: "編集" }));

    expect(screen.getByLabelText("タイトル")).toHaveValue("認証APIの実装");
    expect(screen.getByLabelText("優先度")).toHaveValue("high");

    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(mocks.mutate).toHaveBeenCalledWith({
      id: "task1",
      expectedRevision: 5,
      title: "認証APIの実装",
      description: "JWT の発行と検証",
      priority: "high",
    });
  });

  it("承認不要の遷移（差し戻し）は確認なしで即座に遷移を呼ぶ", async () => {
    const user = userEvent.setup();
    mocks.task = createTask({ status: "in_review" });
    renderTaskDetail();

    await user.click(screen.getByRole("button", { name: "→ 進行中" }));

    expect(mocks.mutate).toHaveBeenCalledWith({
      id: "task1",
      to: "in_progress",
      expectedRevision: 5,
    });
  });

  it("破壊的遷移（done）は確認パネルを挟み、承認して初めて遷移を呼ぶ", async () => {
    const user = userEvent.setup();
    mocks.task = createTask({ status: "in_review" });
    renderTaskDetail();

    await user.click(screen.getByRole("button", { name: "→ 完了" }));

    // 確認するまでは遷移しない
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(
      screen.getByText("「完了」へ遷移します。この操作は取り消せません。"),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "完了にする" }));

    expect(mocks.mutate).toHaveBeenCalledWith({
      id: "task1",
      to: "done",
      expectedRevision: 5,
    });
  });

  it("削除は確認パネルを挟み、承認すると削除を呼んで一覧へ戻る", async () => {
    const user = userEvent.setup();
    mocks.task = createTask();
    renderTaskDetail();

    await user.click(screen.getByRole("button", { name: "タスクを削除" }));

    expect(mocks.mutate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "削除する" }));

    expect(mocks.mutate).toHaveBeenCalledWith({
      id: "task1",
      expectedRevision: 5,
    });
    expect(screen.getByText("一覧画面")).toBeVisible();
  });

  it("確認パネルのキャンセルは操作を実行しない", async () => {
    const user = userEvent.setup();
    mocks.task = createTask();
    renderTaskDetail();

    await user.click(screen.getByRole("button", { name: "タスクを削除" }));
    await user.click(screen.getByRole("button", { name: "キャンセル" }));

    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(screen.queryByText("削除する")).not.toBeInTheDocument();
  });

  it("操作が失敗したらエラーを role=alert で表示する", async () => {
    const user = userEvent.setup();
    mocks.task = createTask({ status: "in_review" });
    mocks.mutate.mockRejectedValueOnce(
      new (await import("convex/values")).ConvexError(
        "状態遷移できません: in_review → in_progress",
      ),
    );
    renderTaskDetail();

    await user.click(screen.getByRole("button", { name: "→ 進行中" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "状態遷移できません",
    );
  });
});
