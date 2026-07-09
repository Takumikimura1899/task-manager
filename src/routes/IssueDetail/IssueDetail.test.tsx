import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IssueDetail } from "./IssueDetail";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * Issue 詳細のローディング表示（Issue #29）と編集フロー（Issue #32）を検証する。
 * Convex は外部依存のためモックし、購読値（issue）とミューテーション呼び出しを
 * テストごとに差し替える。
 */

const mocks = vi.hoisted(() => ({
  issue: undefined as unknown,
  mutate: vi.fn<(args: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock("convex/react", () => ({
  useQuery: () => mocks.issue,
  useMutation: () => mocks.mutate,
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

const renderIssueDetail = () =>
  render(
    <MemoryRouter initialEntries={["/TASK/issues/34"]}>
      <Routes>
        <Route element={<IssueDetail />} path="/:projectKey/issues/:number" />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  mocks.issue = undefined;
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
    expect(screen.getByLabelText("説明")).toHaveValue("認証まわりの説明");
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

  it("保存すると最新 revision を expectedRevision に添えて更新を呼び、閲覧表示へ戻る", async () => {
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
