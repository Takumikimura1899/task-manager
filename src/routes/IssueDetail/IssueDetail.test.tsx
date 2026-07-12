import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IssueDetail } from "./IssueDetail";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * Issue 詳細のローディング表示（Issue #29）と編集フロー（Issue #32）を検証する。
 * Convex は外部依存のためモックし、購読値（issue）とミューテーション呼び出しを
 * テストごとに差し替える。getByRef は引数付き・members.list は引数なしで
 * 呼ばれる性質を使って購読値を出し分ける（TaskDetail.test.tsx と同方式）。
 */

const mocks = vi.hoisted(() => ({
  issue: undefined as unknown,
  members: [] as unknown,
  mutate: vi.fn<(args: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock("convex/react", () => ({
  useQuery: (_query: unknown, args?: unknown) =>
    args === undefined ? mocks.members : mocks.issue,
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

const createIssue = (overrides: Record<string, unknown> = {}) => ({
  _id: "issue1",
  _creationTime: 1751900000000,
  revision: 3,
  projectKey: "TASK",
  number: 34,
  title: "ログイン機能を実装する",
  description: "認証まわりの説明",
  status: "in_progress",
  tasks: [],
  createdByName: "木村",
  updatedAt: 1751900000000,
  ...overrides,
});

// rerender で購読値（mocks.issue）の更新を反映できるよう UI を毎回生成する
// （同一の要素参照を渡すと React が再レンダーを省略するため）
const issueDetailUi = () => (
  <MemoryRouter initialEntries={["/TASK/issues/34"]}>
    <Routes>
      <Route element={<IssueDetail />} path="/:projectKey/issues/:number" />
    </Routes>
  </MemoryRouter>
);

const renderIssueDetail = () => render(issueDetailUi());

beforeEach(() => {
  mocks.issue = undefined;
  mocks.members = [];
  mocks.mutate.mockReset();
  mocks.mutate.mockResolvedValue(undefined);
});

describe("IssueDetail のローディング表示", () => {
  it("読み込み中も戻り導線を維持したままスケルトンを表示する", () => {
    renderIssueDetail();

    expect(
      screen.getByRole("status", { name: "Issue を読み込み中" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← 一覧へ" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});

describe("IssueDetail の編集フロー（Issue #32）", () => {
  it("編集ボタンで現在値が入ったフォームを開き、キャンセルで閲覧表示へ戻る", async () => {
    const user = userEvent.setup();
    mocks.issue = createIssue();
    renderIssueDetail();

    await user.click(screen.getByRole("button", { name: "編集" }));

    expect(screen.getByRole("form", { name: "Issue を編集" })).toBeVisible();
    expect(screen.getByLabelText("タイトル")).toHaveValue(
      "ログイン機能を実装する",
    );
    // 説明エディタは lazy ロードのため findBy で解決を待つ
    expect(await screen.findByLabelText("説明")).toHaveValue(
      "認証まわりの説明",
    );
    // 編集中は閲覧用の見出しを隠す
    expect(
      screen.queryByRole("heading", { name: "ログイン機能を実装する" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "キャンセル" }));

    expect(
      screen.getByRole("heading", { name: "ログイン機能を実装する" }),
    ).toBeVisible();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("保存すると編集開始時点の revision を expectedRevision に添えて更新を呼び、閲覧表示へ戻る", async () => {
    const user = userEvent.setup();
    mocks.issue = createIssue({ revision: 7 });
    renderIssueDetail();

    await user.click(screen.getByRole("button", { name: "編集" }));
    const title = screen.getByLabelText("タイトル");
    await user.clear(title);
    await user.type(title, "  ログイン機能（改）  ");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(mocks.mutate).toHaveBeenCalledWith({
      id: "issue1",
      expectedRevision: 7,
      title: "ログイン機能（改）",
      description: "認証まわりの説明",
    });
    expect(
      screen.queryByRole("form", { name: "Issue を編集" }),
    ).not.toBeInTheDocument();
  });

  it("楽観ロック競合時はエラーと再取得導線を表示し、再読込で最新値から編集し直せる", async () => {
    const user = userEvent.setup();
    const conflictMessage =
      "競合が発生しました。他の更新があったため最新を取得してください。";
    mocks.issue = createIssue();
    mocks.mutate.mockRejectedValueOnce(
      new (await import("convex/values")).ConvexError(conflictMessage),
    );
    renderIssueDetail();

    await user.click(screen.getByRole("button", { name: "編集" }));
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(screen.getByRole("alert")).toHaveTextContent(conflictMessage);

    await user.click(
      screen.getByRole("button", { name: "最新の内容を読み込んで編集し直す" }),
    );

    // useQuery が返す最新値（モックでは同値）でフォームが再初期化され、エラーは消える
    expect(screen.getByLabelText("タイトル")).toHaveValue(
      "ログイン機能を実装する",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("IssueDetail の AddTaskForm 表示", () => {
  it("メンバーがいる場合はタスク一覧末尾に AddTaskForm を表示する", () => {
    mocks.issue = createIssue();
    mocks.members = [{ _id: "member_1", name: "Alice" }];
    renderIssueDetail();

    expect(
      screen.getByRole("button", { name: "＋ タスク" }),
    ).toBeInTheDocument();
  });

  it("メンバーが0件の場合は AddTaskForm を表示しない", () => {
    mocks.issue = createIssue();
    mocks.members = [];
    renderIssueDetail();

    expect(
      screen.queryByRole("button", { name: "＋ タスク" }),
    ).not.toBeInTheDocument();
  });
});

describe("IssueDetail の楽観ロック（Issue #73）", () => {
  const conflictMessage =
    "競合が発生しました。他の更新があったため最新を取得してください。";

  /** サーバー側の楽観ロックを模す: 購読中の最新 revision と不一致なら競合。 */
  const mockOptimisticLockServer = () => {
    mocks.mutate.mockImplementation(async (args) => {
      const current = mocks.issue as { revision: number };
      if (args.expectedRevision !== current.revision) {
        throw new ConvexError(conflictMessage);
      }
      return undefined;
    });
  };

  it("編集開始後に他者の更新で購読値の revision が進んだ場合、保存すると競合 UI を表示する", async () => {
    const user = userEvent.setup();
    mocks.issue = createIssue({ revision: 3 });
    mockOptimisticLockServer();
    const { rerender } = renderIssueDetail();

    await user.click(screen.getByRole("button", { name: "編集" }));

    // 編集中に他者が更新し、購読値が revision 4 へ自動更新される
    mocks.issue = createIssue({ revision: 4, title: "他者による更新" });
    rerender(issueDetailUi());

    await user.click(screen.getByRole("button", { name: "保存" }));

    // 編集開始時点の revision を送るため競合が検知され、再取得導線が出る
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 3 }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(conflictMessage);
    expect(
      screen.getByRole("button", { name: "最新の内容を読み込んで編集し直す" }),
    ).toBeVisible();
  });

  it("保存成功後に revision が進んでも、再編集して再保存できる", async () => {
    const user = userEvent.setup();
    mocks.issue = createIssue({ revision: 3 });
    mockOptimisticLockServer();
    const { rerender } = renderIssueDetail();

    await user.click(screen.getByRole("button", { name: "編集" }));
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(mocks.mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedRevision: 3 }),
    );

    // 保存の反映で購読値の revision が進む
    mocks.issue = createIssue({ revision: 4 });
    rerender(issueDetailUi());

    await user.click(screen.getByRole("button", { name: "編集" }));
    await user.click(screen.getByRole("button", { name: "保存" }));

    // 再編集の draft が新しい revision を持つため、競合にならず保存が完了する
    expect(mocks.mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedRevision: 4 }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("form", { name: "Issue を編集" }),
    ).not.toBeInTheDocument();
  });
});
