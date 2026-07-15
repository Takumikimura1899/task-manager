import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConvexError } from "convex/values";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { ISSUE_STATUS_LABELS, type IssueSummary } from "../../lib/issueMeta";
import { PRIORITY_LABELS } from "../../lib/taskMeta";
import { IssueTable } from "./IssueTable";

/**
 * IssueTable は issues.list の購読値を props で受け取り指標付きで表示し、
 * 削除（issues.remove）だけを自前で持つ。行内容（参照・ステータス・
 * タイトルリンク・優先度・進捗・工数）と、削除確認フロー（§6
 * Human-in-the-Loop：ボタン1クリックでは削除されず、確認パネルを経て
 * 確定/キャンセルする）を検証する。Convex（useMutation）は外部依存のため
 * モックする。
 */

const { removeIssue } = vi.hoisted(() => ({
  removeIssue: vi.fn<(args: unknown) => Promise<unknown>>(),
}));

vi.mock("convex/react", () => ({
  useMutation: () => removeIssue,
}));

const createIssueSummary = (
  overrides: Partial<IssueSummary> = {},
): IssueSummary => ({
  _id: "issue_1" as Id<"issues">,
  _creationTime: 1000,
  project: "project_1" as Id<"projects">,
  number: 34,
  title: "ログイン機能を実装する",
  createdBy: "member_1" as Id<"members">,
  priority: "high",
  revision: 4,
  updatedAt: 1000,
  status: "in_progress",
  taskCount: 4,
  doneCount: 1,
  estimateTotal: 8,
  actualTotal: 0,
  assignees: [],
  ...overrides,
});

const renderTable = (issues: readonly IssueSummary[], projectKey = "TASK") =>
  render(
    <MemoryRouter>
      <IssueTable issues={issues} projectKey={projectKey} />
    </MemoryRouter>,
  );

beforeEach(() => {
  removeIssue.mockReset();
  removeIssue.mockResolvedValue(undefined);
});

describe("IssueTable の空状態", () => {
  it("Issue が0件のときは一覧表を出さず案内文を表示する", () => {
    renderTable([]);

    expect(
      screen.getByRole("heading", { name: "Issue 一覧（0）" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Issue がありません。")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("IssueTable の行内容", () => {
  it("参照・ステータス・タイトルリンク・優先度を表示する", () => {
    renderTable([
      createIssueSummary({
        number: 34,
        title: "ログイン機能を実装する",
        status: "in_progress",
        priority: "high",
      }),
    ]);

    expect(screen.getByText("Issue #34")).toBeInTheDocument();
    expect(
      screen.getByText(ISSUE_STATUS_LABELS.in_progress),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "ログイン機能を実装する" }),
    ).toHaveAttribute("href", "/TASK/issues/34");
    expect(screen.getByText(PRIORITY_LABELS.high)).toBeInTheDocument();
  });

  it("タスク進捗を progress バーと件数テキストで表示する", () => {
    renderTable([createIssueSummary({ taskCount: 4, doneCount: 1 })]);

    const progress = screen.getByRole("progressbar", {
      name: "タスク進捗 1/4",
    });
    expect(progress).toHaveAttribute("value", "25");
    expect(screen.getByText("1/4")).toBeInTheDocument();
  });

  it("タスクが0件のときは進捗0%（0/0）を表示する", () => {
    renderTable([createIssueSummary({ taskCount: 0, doneCount: 0 })]);

    const progress = screen.getByRole("progressbar", {
      name: "タスク進捗 0/0",
    });
    expect(progress).toHaveAttribute("value", "0");
  });

  // 合計 0 は「未入力」と区別できないため、予想・実績とも "—" 表示に統一。
  // 合計は浮動小数点の生値で届くため、表示は formatHoursTotal で丸める。
  // 丸めて 0 になる極小値（バックエンドは 0.001 等も許容）も "—" に統一され、
  // 「0h」と「未入力」の矛盾表示が起きないことを含めて検証する。
  it.each([
    { estimateTotal: 8, actualTotal: 0, estimateText: "8h", actualText: "—" },
    {
      estimateTotal: 0,
      actualTotal: 5,
      estimateText: "—",
      actualText: "5h",
    },
    {
      estimateTotal: 1.1 + 2.2, // 3.3000000000000003
      actualTotal: 0.1 + 0.2, // 0.30000000000000004
      estimateText: "3.3h",
      actualText: "0.3h",
    },
    {
      estimateTotal: 0.004, // 丸めると 0 になる極小値
      actualTotal: 0.005, // 丸めても 0 にならない境界値
      estimateText: "—",
      actualText: "0.01h",
    },
  ])(
    "予想 $estimateTotal / 実績 $actualTotal 時間を表示する",
    ({ estimateTotal, actualTotal, estimateText, actualText }) => {
      renderTable([createIssueSummary({ estimateTotal, actualTotal })]);

      expect(screen.getByText(estimateText)).toBeInTheDocument();
      expect(screen.getByText(actualText)).toBeInTheDocument();
    },
  );
});

describe("IssueTable の削除確認フロー", () => {
  it("削除ボタンをクリックしただけでは削除されず、確認パネルを表示する", async () => {
    const user = userEvent.setup();
    renderTable([createIssueSummary()]);

    await user.click(screen.getByRole("button", { name: "削除" }));

    expect(removeIssue).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "この Issue と配下のタスク・Git 連携をすべて削除します。取り消せません。",
      ),
    ).toBeVisible();
  });

  it("確定すると remove を { id, expectedRevision } で呼ぶ", async () => {
    const user = userEvent.setup();
    renderTable([
      createIssueSummary({ _id: "issue_9" as Id<"issues">, revision: 4 }),
    ]);

    await user.click(screen.getByRole("button", { name: "削除" }));
    await user.click(screen.getByRole("button", { name: "削除する" }));

    expect(removeIssue).toHaveBeenCalledWith({
      id: "issue_9",
      expectedRevision: 4,
    });
  });

  it("キャンセルすると remove を呼ばずに確認パネルを閉じる", async () => {
    const user = userEvent.setup();
    renderTable([createIssueSummary()]);

    await user.click(screen.getByRole("button", { name: "削除" }));
    await user.click(screen.getByRole("button", { name: "キャンセル" }));

    expect(removeIssue).not.toHaveBeenCalled();
    expect(screen.queryByText("削除する")).not.toBeInTheDocument();
  });

  it("確認パネル表示中は全行の削除ボタンを無効化する（pending 切替の競合防止）", async () => {
    const user = userEvent.setup();
    renderTable([
      createIssueSummary({ _id: "issue_1" as Id<"issues">, number: 1 }),
      createIssueSummary({ _id: "issue_2" as Id<"issues">, number: 2 }),
    ]);

    const deleteButtons = screen.getAllByRole("button", { name: "削除" });
    await user.click(deleteButtons[0]);

    for (const button of deleteButtons) {
      expect(button).toBeDisabled();
    }
  });

  it("削除の実行中は確定・キャンセルを無効化し、二重確定しても remove は1回だけ呼ぶ", async () => {
    // 未解決の Promise で「実行中」の状態を固定する
    let resolveRemove: (() => void) | undefined;
    removeIssue.mockImplementationOnce(
      () =>
        new Promise<unknown>((resolve) => {
          resolveRemove = () => resolve(undefined);
        }),
    );
    const user = userEvent.setup();
    renderTable([createIssueSummary()]);

    await user.click(screen.getByRole("button", { name: "削除" }));
    const confirmButton = screen.getByRole("button", { name: "削除する" });
    await user.click(confirmButton);
    await user.click(confirmButton); // 実行中の二重クリック

    expect(removeIssue).toHaveBeenCalledTimes(1);
    expect(confirmButton).toBeDisabled();
    expect(screen.getByRole("button", { name: "キャンセル" })).toBeDisabled();

    resolveRemove?.();
    // 完了後はパネルが閉じ、削除ボタンが再度有効になる
    expect(await screen.findByRole("button", { name: "削除" })).toBeEnabled();
  });

  it("削除が失敗したら role=alert でエラーを表示し、確認パネルを維持する", async () => {
    removeIssue.mockRejectedValueOnce(new ConvexError("削除に失敗しました"));
    const user = userEvent.setup();
    renderTable([createIssueSummary()]);

    await user.click(screen.getByRole("button", { name: "削除" }));
    await user.click(screen.getByRole("button", { name: "削除する" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "削除に失敗しました",
    );
    // 失敗時は確認パネルを閉じず、再試行できる状態を保つ
    expect(
      screen.getByRole("button", { name: "削除する" }),
    ).toBeInTheDocument();
  });

  it("確認パネル表示中に対象 Issue が外部で削除されると、パネルが消え全行の削除ボタンが有効に戻る", async () => {
    const user = userEvent.setup();
    const { rerender } = renderTable([
      createIssueSummary({ _id: "issue_1" as Id<"issues">, number: 1 }),
      createIssueSummary({ _id: "issue_2" as Id<"issues">, number: 2 }),
    ]);

    const deleteButtons = screen.getAllByRole("button", { name: "削除" });
    await user.click(deleteButtons[0]);
    expect(screen.getByText("削除する")).toBeInTheDocument();

    // 別タブ・MCP・他ユーザーによる外部削除を購読更新（props 更新）で再現する
    rerender(
      <MemoryRouter>
        <IssueTable
          issues={[
            createIssueSummary({ _id: "issue_2" as Id<"issues">, number: 2 }),
          ]}
          projectKey="TASK"
        />
      </MemoryRouter>,
    );

    expect(screen.queryByText("削除する")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "削除" })).toBeEnabled();
  });

  it("削除実行中（in-flight）に対象 Issue が外部で消えても、deleting の間は全行の削除ボタンが無効のまま", async () => {
    // 未解決の Promise で「削除実行中」の状態を固定する
    let resolveRemove: (() => void) | undefined;
    removeIssue.mockImplementationOnce(
      () =>
        new Promise<unknown>((resolve) => {
          resolveRemove = () => resolve(undefined);
        }),
    );
    const user = userEvent.setup();
    const { rerender } = renderTable([
      createIssueSummary({ _id: "issue_1" as Id<"issues">, number: 1 }),
      createIssueSummary({ _id: "issue_2" as Id<"issues">, number: 2 }),
    ]);

    await user.click(screen.getAllByRole("button", { name: "削除" })[0]);
    await user.click(screen.getByRole("button", { name: "削除する" }));

    // in-flight 中に対象 Issue が外部（別タブ・MCP・他ユーザー）による
    // 削除で一覧から消える（購読更新 = props 更新で再現）
    rerender(
      <MemoryRouter>
        <IssueTable
          issues={[
            createIssueSummary({ _id: "issue_2" as Id<"issues">, number: 2 }),
          ]}
          projectKey="TASK"
        />
      </MemoryRouter>,
    );

    // 対象消失で確認パネルは消えるが、in-flight の削除が完了するまでは
    // 新たなパネルを開かせない（別行を開けると in-flight の完了ハンドラが
    // その行を誤って操作しうるため）
    expect(screen.queryByText("削除する")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "削除" })).toBeDisabled();

    resolveRemove?.();
    // 完了後は無効化が解除される
    expect(await screen.findByRole("button", { name: "削除" })).toBeEnabled();
  });

  it("パネル表示中に対象 Issue の revision が進むと、確定は最新の revision で remove を呼ぶ", async () => {
    const user = userEvent.setup();
    const { rerender } = renderTable([
      createIssueSummary({ _id: "issue_9" as Id<"issues">, revision: 4 }),
    ]);

    await user.click(screen.getByRole("button", { name: "削除" }));

    // パネルを開いている間に別更新で revision が進んだ状態を再現する
    rerender(
      <MemoryRouter>
        <IssueTable
          issues={[
            createIssueSummary({
              _id: "issue_9" as Id<"issues">,
              revision: 7,
            }),
          ]}
          projectKey="TASK"
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "削除する" }));

    expect(removeIssue).toHaveBeenCalledWith({
      id: "issue_9",
      expectedRevision: 7,
    });
  });
});
