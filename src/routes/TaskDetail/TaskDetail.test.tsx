import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConvexError } from "convex/values";
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

// Markdown エディタは jsdom で不安定な重量ライブラリのため textarea スタブへ差し替える
vi.mock("../../components/MarkdownEditor/MarkdownEditor", () => ({
  MarkdownEditor: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string;
    onChange: (value: string) => void;
    ariaLabel: string;
  }) => (
    <textarea
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      value={value}
    />
  ),
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

// rerender で購読値（mocks.task）の更新を反映できるよう UI を毎回生成する
// （同一の要素参照を渡すと React が再レンダーを省略するため）
const taskDetailUi = () => (
  <MemoryRouter initialEntries={["/TASK/tasks/12"]}>
    <Routes>
      <Route element={<p>一覧画面</p>} path="/" />
      <Route element={<TaskDetail />} path="/:projectKey/tasks/:number" />
    </Routes>
  </MemoryRouter>
);

const renderTaskDetail = () => render(taskDetailUi());

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
  it("編集ボタンで現在値（優先度含む）が入ったフォームを開き、保存で編集開始時点の revision を添えて更新する", async () => {
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
      estimate: null,
      actual: null,
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

describe("TaskDetail の楽観ロック（Issue #73）", () => {
  const conflictMessage =
    "競合が発生しました。他の更新があったため最新を取得してください。";

  /** サーバー側の楽観ロックを模す: 購読中の最新 revision と不一致なら競合。 */
  const mockOptimisticLockServer = () => {
    mocks.mutate.mockImplementation(async (args) => {
      const current = mocks.task as { revision: number };
      if (args.expectedRevision !== current.revision) {
        throw new ConvexError(conflictMessage);
      }
      return undefined;
    });
  };

  it("編集開始後に他者の更新で購読値の revision が進んだ場合、保存すると競合 UI を表示する", async () => {
    const user = userEvent.setup();
    mocks.task = createTask({ revision: 5 });
    mockOptimisticLockServer();
    const { rerender } = renderTaskDetail();

    await user.click(screen.getByRole("button", { name: "編集" }));

    // 編集中に他者が更新し、購読値が revision 6 へ自動更新される
    mocks.task = createTask({ revision: 6, title: "他者による更新" });
    rerender(taskDetailUi());

    await user.click(screen.getByRole("button", { name: "保存" }));

    // 編集開始時点の revision を送るため競合が検知され、再取得導線が出る
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 5 }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(conflictMessage);
    expect(
      screen.getByRole("button", { name: "最新の内容を読み込んで編集し直す" }),
    ).toBeVisible();
  });

  it("保存成功後に revision が進んでも、再編集して再保存できる", async () => {
    const user = userEvent.setup();
    mocks.task = createTask({ revision: 5 });
    mockOptimisticLockServer();
    const { rerender } = renderTaskDetail();

    await user.click(screen.getByRole("button", { name: "編集" }));
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(mocks.mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedRevision: 5 }),
    );

    // 保存の反映で購読値の revision が進む
    mocks.task = createTask({ revision: 6 });
    rerender(taskDetailUi());

    await user.click(screen.getByRole("button", { name: "編集" }));
    await user.click(screen.getByRole("button", { name: "保存" }));

    // 再編集の draft が新しい revision を持つため、競合にならず保存が完了する
    expect(mocks.mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedRevision: 6 }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("form", { name: "タスクを編集" }),
    ).not.toBeInTheDocument();
  });
});
