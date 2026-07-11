import type {
  DndContextProps,
  DragCancelEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import { act, render, screen, within } from "@testing-library/react";
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

const { boardQuery, mutate, dndHandlers } = vi.hoisted(() => ({
  boardQuery: vi.fn<() => unknown>(),
  mutate: vi.fn<(args: unknown) => Promise<unknown>>(),
  // DndContext に渡されたコールバックの捕捉先。jsdom では実ポインタ操作で
  // dnd-kit のドラッグを再現できないため、外部依存である dnd-kit との契約
  // （onDragStart/Over/Cancel の発火）をテスト側から直接駆動する。
  dndHandlers: { current: null as DndContextProps | null },
}));

vi.mock("convex/react", () => ({
  useQuery: () => boardQuery(),
  useMutation: () => mutate,
}));

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: (props: DndContextProps) => {
      dndHandlers.current = props;
      return <actual.DndContext {...props} />;
    },
  };
});

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
  dndHandlers.current = null;
});

/** ラベルの列（section）を取得し、その中のカードリンク有無を検証できるようにする。 */
function getColumn(label: string): HTMLElement {
  const section = screen.getByText(label).closest("section");
  if (!section) throw new Error(`列 ${label} が見つかりません`);
  return section;
}

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

describe("Board のドラッグキャンセル（Issue #78）", () => {
  it("列またぎの dragOver 後にキャンセルすると元の列構成へ戻り、mutation を呼ばない", () => {
    boardQuery.mockReturnValue(createColumns({ todo: [createTask()] }));
    renderBoard();

    const handlers = dndHandlers.current;
    if (!handlers) throw new Error("DndContext が描画されていません");

    act(() => {
      handlers.onDragStart?.({
        active: { id: "task_1" },
      } as DragStartEvent);
      handlers.onDragOver?.({
        active: { id: "task_1" },
        over: { id: "in_progress" },
      } as DragOverEvent);
    });

    // 前提の確認: dragOver でカードは進行中列へローカル移動している
    expect(
      within(getColumn(TASK_STATUS_LABELS.in_progress)).getByRole("link", {
        name: "TASK-12",
      }),
    ).toBeInTheDocument();

    act(() => {
      handlers.onDragCancel?.({
        active: { id: "task_1" },
        over: null,
      } as DragCancelEvent);
    });

    // キャンセルで server スナップショットへ復元される（未着手列へ戻る）
    expect(
      within(getColumn(TASK_STATUS_LABELS.todo)).getByRole("link", {
        name: "TASK-12",
      }),
    ).toBeInTheDocument();
    expect(
      within(getColumn(TASK_STATUS_LABELS.in_progress)).queryByRole("link", {
        name: "TASK-12",
      }),
    ).not.toBeInTheDocument();
    // キャンセルなので move / transitionStatus はどちらも呼ばれない
    expect(mutate).not.toHaveBeenCalled();
  });
});
