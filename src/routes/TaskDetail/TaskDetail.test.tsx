import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskDetail } from "./TaskDetail";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import {
  describeDeleteInFlightFlows,
  describeOptimisticLockFlows,
  itConfirmPanelAutoCloses,
} from "../../../test/detailPageFlows";

/**
 * Task 詳細のローディング表示（Issue #29）と編集操作（Issue #32:
 * ステータス遷移・破壊的操作の確認・削除）を検証する。
 * Convex は外部依存のためモックする。担当者候補は projectMembers.listByProject
 * を購読するため（ADR-11 PR③）、getDetail とは getFunctionName による
 * 名前ベースディスパッチで出し分ける（IssueDetail.test.tsx と同方式）。
 */

const mocks = vi.hoisted(() => ({
  task: undefined as unknown,
  members: [] as unknown,
  mutate: vi.fn<(args: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (query: unknown, _args?: unknown) => {
      const name = getFunctionName(
        query as Parameters<typeof getFunctionName>[0],
      );
      if (name === "projectMembers:listByProject") return mocks.members;
      return mocks.task;
    },
    useMutation: () => mocks.mutate,
  };
});

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
  project: "project1",
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

// number スコープ検証用: TaskDetail と同一 Router 内から任意の Task へ
// client-side 遷移するためのヘルパ（削除 in-flight 中の遷移を再現する）。
function GoToTask99Button() {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate("/TASK/tasks/99")} type="button">
      go-to-next
    </button>
  );
}

const renderTaskDetailWithNavHelper = () =>
  render(
    <MemoryRouter initialEntries={["/TASK/tasks/12"]}>
      <GoToTask99Button />
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
      screen.getByRole("status", { name: "Task を読み込み中" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← 一覧へ" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});

describe("TaskDetail の工数表示", () => {
  it("二進浮動小数点の加算誤差を丸めて表示する（formatHours）", () => {
    mocks.task = createTask({ estimate: 1.1 + 2.2, actual: 0.1 + 0.2 });
    renderTaskDetail();

    expect(screen.getByText("3.3h")).toBeInTheDocument();
    expect(screen.getByText("0.3h")).toBeInTheDocument();
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
      startDate: null,
      dueDate: null,
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

    await user.click(screen.getByRole("button", { name: "Task を削除" }));

    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "この Task を削除します。関連する Git 連携も併せて削除されます。取り消せません。",
      ),
    ).toBeVisible();

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

    await user.click(screen.getByRole("button", { name: "Task を削除" }));
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

/**
 * 削除フロー（Issue #104 追加対応）in-flight 3パターン・確認パネル自動クローズ・
 * 楽観ロック（Issue #73）2パターンは IssueDetail.test.tsx とセットアップ／
 * アサーション構造が同一のため、test/detailPageFlows.ts の共有ファクトリへ
 * 委譲する（エンティティ差分は harness で注入）。状態遷移パネルとの相互排他
 * テスト（TaskDetail 固有）はここに含めず、下の describe に個別のまま残す。
 */
const taskFlowHarness = {
  createEntity: createTask,
  setEntity: (v: unknown) => {
    mocks.task = v;
  },
  render: renderTaskDetail,
  renderWithNavHelper: renderTaskDetailWithNavHelper,
  ui: taskDetailUi,
  mutate: mocks.mutate,
};

describe("TaskDetail の楽観ロック（Issue #73）", () => {
  describeOptimisticLockFlows({
    ...taskFlowHarness,
    editFormLabel: "Task を編集",
    testTitles: {
      conflictOnSave:
        "編集開始後に他者の更新で購読値の revision が進んだ場合、保存すると競合 UI を表示する",
      retryAfterSuccess:
        "保存成功後に revision が進んでも、再編集して再保存できる",
    },
  });
});

describe("TaskDetail の確認パネル revision", () => {
  it("削除確認パネル表示中に購読値の revision が進んだ場合、確定時は最新の revision を送る", async () => {
    const user = userEvent.setup();
    mocks.task = createTask({ revision: 5 });
    const { rerender } = renderTaskDetail();

    await user.click(screen.getByRole("button", { name: "Task を削除" }));

    // パネル表示中に他クライアントが更新し、購読値の revision が進む
    mocks.task = createTask({ revision: 6 });
    rerender(taskDetailUi());

    await user.click(screen.getByRole("button", { name: "削除する" }));

    // パネルを開いた時点（5）ではなく、確定時点の最新値（6）を送る
    expect(mocks.mutate).toHaveBeenCalledWith({
      id: "task1",
      expectedRevision: 6,
    });
  });
});

describe("TaskDetail の削除フロー（Issue #104 追加対応・IssueDetail と対称）", () => {
  it("task が見つかっている状態で削除に失敗すると、確認パネルを開いたままエラーを role=alert で表示する（レビュー指摘: 確定前にパネルを閉じるとエラーの表示先が消えサイレント失敗になっていた）", async () => {
    const user = userEvent.setup();
    mocks.task = createTask();
    mocks.mutate.mockRejectedValueOnce(
      new (await import("convex/values")).ConvexError(
        "Issue の最後の Task は削除できません",
      ),
    );
    renderTaskDetail();

    await user.click(screen.getByRole("button", { name: "Task を削除" }));
    await user.click(screen.getByRole("button", { name: "削除する" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Issue の最後の Task は削除できません",
    );
    // 確認パネルが閉じずに開いたままエラーを表示する（削除する／キャンセルの
    // 両ボタンが残っている＝ConfirmPanel がアンマウントされていない）。
    expect(
      screen.getByRole("button", { name: "削除する" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "キャンセル" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("一覧画面")).not.toBeInTheDocument();
  });

  describeDeleteInFlightFlows({
    ...taskFlowHarness,
    deleteButtonLabel: "Task を削除",
    loadingStatusLabel: "Task を読み込み中",
    notFoundText: "Task が見つかりませんでした。",
    listScreenText: "一覧画面",
    testTitles: {
      readYourWrites:
        "削除確定直後に購読側が read-your-writes で task を null にしても、not-found を表示せずローディングのまま一覧へ遷移する",
      inFlightNav:
        "削除 in-flight 中に別の（存在しない）Task へ client-side 遷移すると、その Task は not-found を表示し、削除完了時も強制遷移しない",
      concurrentDelete:
        "並行削除（他ユーザーが先に削除）と自分の削除失敗が重なっても、not-found 画面にエラーを表示する（サイレント失敗の回避）",
    },
  });

  itConfirmPanelAutoCloses({
    ...taskFlowHarness,
    openPanelButtonLabel: "→ 完了",
    panelText: "「完了」へ遷移します。この操作は取り消せません。",
    currentEntityOverrides: { number: 12, status: "in_review" },
    otherEntityOverrides: { number: 99, title: "別の Task" },
    testTitle:
      "遷移確認パネルを開いたまま別の Task へ遷移すると、確認パネルが閉じる",
  });

  it("遷移確認パネルを開いた状態で削除を要求すると、遷移確認パネルが閉じ削除確認パネルに切り替わる（相互排他・レビュー指摘対応）", async () => {
    const user = userEvent.setup();
    mocks.task = createTask({ status: "in_review" });
    renderTaskDetail();

    await user.click(screen.getByRole("button", { name: "→ 完了" }));
    expect(
      screen.getByText("「完了」へ遷移します。この操作は取り消せません。"),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Task を削除" }));

    expect(
      screen.queryByText("「完了」へ遷移します。この操作は取り消せません。"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "この Task を削除します。関連する Git 連携も併せて削除されます。取り消せません。",
      ),
    ).toBeVisible();
  });

  it("削除確認パネルを開いた状態で遷移を要求すると、削除確認パネルが閉じ遷移確認パネルに切り替わる（相互排他・レビュー指摘対応）", async () => {
    const user = userEvent.setup();
    mocks.task = createTask({ status: "in_review" });
    renderTaskDetail();

    await user.click(screen.getByRole("button", { name: "Task を削除" }));
    expect(
      screen.getByText(
        "この Task を削除します。関連する Git 連携も併せて削除されます。取り消せません。",
      ),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "→ 完了" }));

    expect(
      screen.queryByText(
        "この Task を削除します。関連する Git 連携も併せて削除されます。取り消せません。",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("「完了」へ遷移します。この操作は取り消せません。"),
    ).toBeVisible();
  });
});
