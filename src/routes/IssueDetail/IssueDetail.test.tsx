import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IssueDetail } from "./IssueDetail";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";

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
  priority: "none",
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
      <Route element={<p>Issue 一覧画面</p>} path="/issues" />
      <Route element={<IssueDetail />} path="/:projectKey/issues/:number" />
    </Routes>
  </MemoryRouter>
);

const renderIssueDetail = () => render(issueDetailUi());

// number スコープ検証用: IssueDetail と同一 Router 内から任意の Issue へ
// client-side 遷移するためのヘルパ（削除 in-flight 中の遷移を再現する）。
function GoToIssue57Button() {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate("/TASK/issues/57")} type="button">
      go-to-57
    </button>
  );
}

const renderIssueDetailWithNavHelper = () =>
  render(
    <MemoryRouter initialEntries={["/TASK/issues/34"]}>
      <GoToIssue57Button />
      <Routes>
        <Route element={<p>Issue 一覧画面</p>} path="/issues" />
        <Route element={<IssueDetail />} path="/:projectKey/issues/:number" />
      </Routes>
    </MemoryRouter>,
  );

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
      "/issues",
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
      priority: "none",
    });
    expect(
      screen.queryByRole("form", { name: "Issue を編集" }),
    ).not.toBeInTheDocument();
  });

  it("編集フォームに優先度 select が現在値入りで表示される", async () => {
    const user = userEvent.setup();
    mocks.issue = createIssue({ priority: "high" });
    renderIssueDetail();

    await user.click(screen.getByRole("button", { name: "編集" }));

    expect(screen.getByLabelText("優先度")).toHaveValue("high");
  });

  it("優先度を変更して保存すると update に新しい priority が渡る", async () => {
    const user = userEvent.setup();
    mocks.issue = createIssue({ priority: "none" });
    renderIssueDetail();

    await user.click(screen.getByRole("button", { name: "編集" }));
    await user.selectOptions(screen.getByLabelText("優先度"), "urgent");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ priority: "urgent" }),
    );
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
  it("メンバーがいる場合はタスク一覧末尾に AddTaskForm を表示し、NoMembersNotice は出さない", () => {
    mocks.issue = createIssue();
    mocks.members = [{ _id: "member_1", name: "Alice" }];
    renderIssueDetail();

    expect(
      screen.getByRole("button", { name: "＋ Task を作成" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("メンバーが0件（ロード完了）の場合は AddTaskForm の代わりに NoMembersNotice を表示する（Issue #16）", () => {
    mocks.issue = createIssue();
    mocks.members = [];
    renderIssueDetail();

    expect(
      screen.queryByRole("button", { name: "＋ Task を作成" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(
      "メンバーが登録されていない",
    );
  });

  it("メンバーがロード中（undefined）は AddTaskForm も NoMembersNotice も出さない", () => {
    mocks.issue = createIssue();
    mocks.members = undefined;
    renderIssueDetail();

    expect(
      screen.queryByRole("button", { name: "＋ Task を作成" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
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

describe("IssueDetail のステータス説明・見出し表記（Issue #104）", () => {
  it("ステータスバッジの下に、配下 Task から自動算出される旨の説明文を表示する", () => {
    mocks.issue = createIssue();
    renderIssueDetail();

    expect(
      screen.getByText("ステータスは配下 Task から自動算出されます"),
    ).toBeVisible();
  });

  it("Task セクション見出し・進捗表示が英語表記の Task で統一されている", () => {
    mocks.issue = createIssue({
      tasks: [
        {
          _id: "task1",
          number: 1,
          title: "設計する",
          priority: "none",
          status: "done",
        },
        {
          _id: "task2",
          number: 2,
          title: "実装する",
          priority: "none",
          status: "todo",
        },
      ],
    });
    renderIssueDetail();

    expect(
      screen.getByRole("heading", { name: "Task（2）" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Task 1/2 完了")).toBeInTheDocument();
  });
});

describe("IssueDetail の削除フロー（Issue #104）", () => {
  it("danger セクションの削除は確認パネルを挟み、承認すると削除を呼んで Issue 一覧へ戻る", async () => {
    const user = userEvent.setup();
    mocks.issue = createIssue({ revision: 3 });
    renderIssueDetail();

    await user.click(screen.getByRole("button", { name: "Issue を削除" }));

    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "この Issue と配下の Task・Git 連携をすべて削除します。取り消せません。",
      ),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "削除する" }));

    expect(mocks.mutate).toHaveBeenCalledWith({
      id: "issue1",
      expectedRevision: 3,
    });
    expect(screen.getByText("Issue 一覧画面")).toBeVisible();
  });

  it("確認パネルのキャンセルは削除を実行しない", async () => {
    const user = userEvent.setup();
    mocks.issue = createIssue();
    renderIssueDetail();

    await user.click(screen.getByRole("button", { name: "Issue を削除" }));
    await user.click(screen.getByRole("button", { name: "キャンセル" }));

    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(screen.queryByText("削除する")).not.toBeInTheDocument();
  });

  it("削除に失敗したらエラーを role=alert で表示し、一覧へは遷移しない", async () => {
    const user = userEvent.setup();
    mocks.issue = createIssue();
    mocks.mutate.mockRejectedValueOnce(
      new (await import("convex/values")).ConvexError("削除に失敗しました"),
    );
    renderIssueDetail();

    await user.click(screen.getByRole("button", { name: "Issue を削除" }));
    await user.click(screen.getByRole("button", { name: "削除する" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "削除に失敗しました",
    );
    expect(screen.queryByText("Issue 一覧画面")).not.toBeInTheDocument();
  });

  it("削除確定直後に購読側が read-your-writes で issue を null にしても、not-found を表示せずローディングのまま一覧へ遷移する", async () => {
    const user = userEvent.setup();
    mocks.issue = createIssue({ revision: 3 });
    let resolveRemove: (() => void) | undefined;
    mocks.mutate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRemove = resolve;
        }),
    );
    const { rerender } = renderIssueDetail();

    await user.click(screen.getByRole("button", { name: "Issue を削除" }));
    await user.click(screen.getByRole("button", { name: "削除する" }));

    // removeIssue がまだ解決していない間に、購読側（getByRef）が
    // read-your-writes で先に issue=null を返す状況を再現する。
    mocks.issue = null;
    rerender(issueDetailUi());

    expect(
      screen.queryByText("Issue が見つかりませんでした。"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "Issue を読み込み中" }),
    ).toBeInTheDocument();

    resolveRemove?.();

    expect(await screen.findByText("Issue 一覧画面")).toBeVisible();
  });

  it("削除 in-flight 中に別の（存在しない）Issue へ client-side 遷移すると、その Issue は not-found を表示し、削除完了時も強制遷移しない（Issue #104 追加対応）", async () => {
    const user = userEvent.setup();
    mocks.issue = createIssue({ number: 34, revision: 3 });
    let resolveRemove: (() => void) | undefined;
    mocks.mutate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRemove = resolve;
        }),
    );
    renderIssueDetailWithNavHelper();

    await user.click(screen.getByRole("button", { name: "Issue を削除" }));
    await user.click(screen.getByRole("button", { name: "削除する" }));

    // Issue 34 の削除が in-flight のまま、別の（購読側が null を返す＝
    // 存在しない）Issue 57 へ client-side 遷移する。
    mocks.issue = null;
    await user.click(screen.getByRole("button", { name: "go-to-57" }));

    // Issue 34 の deletingNumber は Issue 57 の表示に波及せず、本当に
    // 見つからない Issue として扱われる（誤ってローディング表示のままには
    // ならない）。
    expect(screen.getByText("Issue が見つかりませんでした。")).toBeVisible();
    expect(
      screen.queryByRole("status", { name: "Issue を読み込み中" }),
    ).not.toBeInTheDocument();

    // Issue 34 の削除が完了しても、Issue 57 を見ているユーザーを一覧へ
    // 強制遷移しない。
    await act(async () => {
      resolveRemove?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText("Issue 一覧画面")).not.toBeInTheDocument();
    expect(screen.getByText("Issue が見つかりませんでした。")).toBeVisible();
  });

  it("並行削除（他ユーザーが先に削除）と自分の削除失敗が重なっても、not-found 画面にエラーを表示する（サイレント失敗の回避・Issue #104 追加対応）", async () => {
    const user = userEvent.setup();
    mocks.issue = createIssue({ revision: 3 });
    mocks.mutate.mockRejectedValueOnce(
      new (await import("convex/values")).ConvexError("削除に失敗しました"),
    );
    const { rerender } = renderIssueDetail();

    await user.click(screen.getByRole("button", { name: "Issue を削除" }));
    await user.click(screen.getByRole("button", { name: "削除する" }));

    // 自分の削除は失敗する一方、購読側は他ユーザーの削除により issue=null
    // を返す（並行削除）。
    mocks.issue = null;
    rerender(issueDetailUi());

    expect(screen.getByText("Issue が見つかりませんでした。")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("削除に失敗しました");
  });

  it("削除確認パネルを開いたまま別の Issue へ遷移すると、確認パネルが閉じる（Issue #104 追加対応）", async () => {
    const user = userEvent.setup();
    mocks.issue = createIssue({ number: 34 });
    renderIssueDetailWithNavHelper();

    await user.click(screen.getByRole("button", { name: "Issue を削除" }));
    expect(
      screen.getByText(
        "この Issue と配下の Task・Git 連携をすべて削除します。取り消せません。",
      ),
    ).toBeVisible();

    // 確認する前に、別の（実在する）Issue 57 へ client-side 遷移する。
    mocks.issue = createIssue({ number: 57, title: "別の Issue" });
    await user.click(screen.getByRole("button", { name: "go-to-57" }));

    // Issue 34 用の確認パネルが Issue 57 の画面に残っていない。
    expect(
      screen.queryByText(
        "この Issue と配下の Task・Git 連携をすべて削除します。取り消せません。",
      ),
    ).not.toBeInTheDocument();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});
