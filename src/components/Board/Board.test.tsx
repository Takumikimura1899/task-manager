import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import type { BoardTask } from "../../lib/board";
import {
  type TaskStatus,
  TASK_STATUS_LABELS,
  TASK_STATUS_ORDER,
} from "../../lib/taskMeta";
import skeletonStyles from "../Skeleton/Skeleton.module.css";
import { Board } from "./Board";

/**
 * ボードのローディング表示と空状態（Issue #29）を検証する。
 * - 初期ロード中は全画面差し替えでなく、カンバンの列枠＋スケルトンを出す
 * - タスク皆無でも列は維持しつつ、作成導線への案内メッセージを出す
 * D&D の並べ替え挙動は lib/board のユニットテストに委ね、ここでは
 * 観測可能な描画結果のみを対象とする。Convex は外部依存のためモックする。
 */

const { boardQuery, mutate } = vi.hoisted(() => ({
  boardQuery: vi.fn<() => unknown>(),
  mutate: vi.fn<(args: unknown) => Promise<unknown>>(),
}));

vi.mock("convex/react", () => ({
  useQuery: () => boardQuery(),
  useMutation: () => mutate,
}));

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

const createColumns = (
  tasksByStatus: Partial<Record<TaskStatus, BoardTask[]>> = {},
) =>
  TASK_STATUS_ORDER.map((status) => ({
    status,
    tasks: tasksByStatus[status] ?? [],
  }));

const renderBoard = () =>
  render(
    <MemoryRouter>
      <Board project={"project_1" as Id<"projects">} projectKey="TASK" />
    </MemoryRouter>,
  );

beforeEach(() => {
  boardQuery.mockReset();
  mutate.mockReset();
});

describe("Board のローディング表示", () => {
  it("読み込み中は列枠（全ステータスの列見出し）を維持したままスケルトンを表示する", () => {
    boardQuery.mockReturnValue(undefined);
    renderBoard();

    const status = screen.getByRole("status", { name: "ボードを読み込み中" });
    for (const label of Object.values(TASK_STATUS_LABELS)) {
      expect(within(status).getByText(label)).toBeInTheDocument();
    }
    expect(
      status.getElementsByClassName(skeletonStyles.skeleton).length,
    ).toBeGreaterThan(0);
  });
});

describe("Board の空状態", () => {
  it("タスクが1件も無いときは列を維持したまま作成導線への案内を表示する", () => {
    boardQuery.mockReturnValue(createColumns());
    renderBoard();

    expect(
      screen.getByText(/タスクがありません。Issue 一覧の「＋ タスク」/),
    ).toBeInTheDocument();
    // 空でもカンバンの6列（droppable）は描画されたまま
    for (const label of Object.values(TASK_STATUS_LABELS)) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // ローディングは終わっているためスケルトンの status リージョンは出さない
    // （dnd-kit 自身の live region が role="status" を持つため名前で絞る）
    expect(
      screen.queryByRole("status", { name: "ボードを読み込み中" }),
    ).not.toBeInTheDocument();
  });

  it("タスクがあるときは案内を出さず、カードを表示する", () => {
    boardQuery.mockReturnValue(createColumns({ todo: [createTask()] }));
    renderBoard();

    expect(screen.queryByText(/タスクがありません/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "TASK-12" })).toBeInTheDocument();
  });
});
