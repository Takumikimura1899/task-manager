import type {
  DndContextProps,
  DragCancelEvent,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createMemoryRouter,
  MemoryRouter,
  RouterProvider,
} from "react-router-dom";
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
import boardStyles from "./Board.module.css";

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

const renderBoard = (initialEntries: string[] = ["/"]) =>
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <Board project={"project_1" as Id<"projects">} projectKey="TASK" />
    </MemoryRouter>,
  );

/**
 * URL 変更（フィルタ更新）を描画後に発生させたいテスト専用のレンダラ。
 * MemoryRouter は初期 URL しか受け取れないため、data router
 * （createMemoryRouter + RouterProvider）で router.navigate による
 * 遷移を可能にする。
 */
const renderBoardWithRouter = (initialEntries: string[] = ["/"]) => {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <Board project={"project_1" as Id<"projects">} projectKey="TASK" />
        ),
      },
    ],
    { initialEntries },
  );
  const view = render(<RouterProvider router={router} />);
  return { ...view, router };
};

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

describe("Board のドラッグ中アニメーション抑止（Issue #79）", () => {
  const startDrag = () => {
    const handlers = dndHandlers.current;
    if (!handlers) throw new Error("DndContext が描画されていません");
    act(() => {
      handlers.onDragStart?.({ active: { id: "task_1" } } as DragStartEvent);
    });
    return handlers;
  };

  it("ドラッグ開始で抑止クラスが付き、ドロップで外れる", () => {
    boardQuery.mockReturnValue(createColumns({ todo: [createTask()] }));
    const { container } = renderBoard();
    const boardEl = container.querySelector(`.${boardStyles.board}`);

    expect(boardEl).not.toHaveClass(boardStyles.boardDragging);
    const handlers = startDrag();
    expect(boardEl).toHaveClass(boardStyles.boardDragging);

    act(() => {
      // over: null は既存挙動どおり no-op（mutation なし）で終了する
      handlers.onDragEnd?.({
        active: { id: "task_1" },
        over: null,
      } as DragEndEvent);
    });
    expect(boardEl).not.toHaveClass(boardStyles.boardDragging);
  });

  it("キャンセルでも抑止クラスが外れる", () => {
    boardQuery.mockReturnValue(createColumns({ todo: [createTask()] }));
    const { container } = renderBoard();
    const boardEl = container.querySelector(`.${boardStyles.board}`);

    const handlers = startDrag();
    expect(boardEl).toHaveClass(boardStyles.boardDragging);

    act(() => {
      handlers.onDragCancel?.({
        active: { id: "task_1" },
        over: null,
      } as DragCancelEvent);
    });
    expect(boardEl).not.toHaveClass(boardStyles.boardDragging);
  });
});

/**
 * priority/assignee フィルタ（Issue #92）の board 派生を検証する。
 * フィルタの絞り込み自体（AND 条件・列構造保持）は lib/board.test.ts の
 * applyBoardFilter 単体テストで検証済みのため、ここでは Board が
 * useFilterParams（URL）からフィルタを受け取り、同期 effect / 空状態表示に
 * 一貫して反映することだけを確認する。
 */
describe("Board のフィルタ適用（Issue #92）", () => {
  it("URL の priority/assignee クエリで該当カードのみ各列に残る（暗黙 AND）", () => {
    const match = createTask({
      _id: "task_1" as Id<"tasks">,
      number: 1,
      priority: "high",
      assignee: "member_1" as Id<"members">,
    });
    const wrongPriority = createTask({
      _id: "task_2" as Id<"tasks">,
      number: 2,
      priority: "low",
      assignee: "member_1" as Id<"members">,
    });
    const wrongAssignee = createTask({
      _id: "task_3" as Id<"tasks">,
      number: 3,
      priority: "high",
      assignee: "member_2" as Id<"members">,
    });
    boardQuery.mockReturnValue(
      createColumns({ todo: [match, wrongPriority, wrongAssignee] }),
    );
    renderBoard(["/?priority=high&assignee=member_1"]);

    expect(screen.getByRole("link", { name: "TASK-1" })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "TASK-2" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "TASK-3" }),
    ).not.toBeInTheDocument();
  });

  it("URL のフィルタ変更で board が再派生される", async () => {
    const high = createTask({
      _id: "task_1" as Id<"tasks">,
      number: 1,
      priority: "high",
    });
    const low = createTask({
      _id: "task_2" as Id<"tasks">,
      number: 2,
      priority: "low",
    });
    boardQuery.mockReturnValue(createColumns({ todo: [high, low] }));
    const { router } = renderBoardWithRouter();

    expect(screen.getByRole("link", { name: "TASK-1" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "TASK-2" })).toBeInTheDocument();

    await act(async () => {
      await router.navigate("/?priority=high");
    });

    expect(screen.getByRole("link", { name: "TASK-1" })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "TASK-2" }),
    ).not.toBeInTheDocument();
  });

  it("ドラッグ開始後の URL フィルタ変更は board を即座に書き換えない（ドロップ後に反映される仕様）", async () => {
    const high = createTask({
      _id: "task_1" as Id<"tasks">,
      number: 1,
      priority: "high",
    });
    const low = createTask({
      _id: "task_2" as Id<"tasks">,
      number: 2,
      priority: "low",
    });
    boardQuery.mockReturnValue(createColumns({ todo: [high, low] }));
    const { router } = renderBoardWithRouter();

    const handlers = dndHandlers.current;
    if (!handlers) throw new Error("DndContext が描画されていません");

    act(() => {
      handlers.onDragStart?.({ active: { id: "task_1" } } as DragStartEvent);
    });

    await act(async () => {
      await router.navigate("/?priority=high");
    });

    // ドラッグ中は同期 effect が activeTask で早期 return するため、
    // フィルタ変更後も両カードとも表示されたまま（ドロップ後に反映される）
    expect(screen.getByRole("link", { name: "TASK-1" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "TASK-2" })).toBeInTheDocument();
  });
});

describe("Board のフィルタ中の空状態（Issue #92）", () => {
  it("フィルタに一致するタスクが無いときはクリア導線を出し、作成導線は出さない", () => {
    boardQuery.mockReturnValue(
      createColumns({ todo: [createTask({ priority: "low" })] }),
    );
    renderBoard(["/?priority=high"]);

    expect(
      screen.getByText("フィルタに一致するタスクがありません。"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "フィルタをクリア" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Issue 一覧の「＋ タスク」/),
    ).not.toBeInTheDocument();
  });

  it("クリア導線を押すとフィルタが解除され、隠れていたカードが再表示される", async () => {
    const user = userEvent.setup();
    boardQuery.mockReturnValue(
      createColumns({ todo: [createTask({ priority: "low" })] }),
    );
    renderBoard(["/?priority=high"]);

    await user.click(screen.getByRole("button", { name: "フィルタをクリア" }));

    expect(screen.getByRole("link", { name: "TASK-12" })).toBeInTheDocument();
    expect(
      screen.queryByText("フィルタに一致するタスクがありません。"),
    ).not.toBeInTheDocument();
  });

  it("server snapshot 自体が0件のときは、フィルタ指定があっても作成導線を出す（クリア導線は出さない）", () => {
    boardQuery.mockReturnValue(createColumns());
    renderBoard(["/?priority=high"]);

    expect(
      screen.getByText(/タスクがありません。Issue 一覧の「＋ タスク」/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("フィルタに一致するタスクがありません。"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "フィルタをクリア" }),
    ).not.toBeInTheDocument();
  });
});

describe("Board のフィルタ中の D&D（Issue #92）", () => {
  it("同一列内の並べ替えはフル列（未フィルタ）の実隣接 rank で moveTask を呼ぶ", async () => {
    const task1 = createTask({
      _id: "task_1" as Id<"tasks">,
      number: 1,
      priority: "high",
      rank: "a0",
    });
    const hidden = createTask({
      _id: "task_2" as Id<"tasks">,
      number: 2,
      priority: "low",
      rank: "a1",
    });
    const task3 = createTask({
      _id: "task_3" as Id<"tasks">,
      number: 3,
      priority: "high",
      rank: "a2",
    });
    boardQuery.mockReturnValue(createColumns({ todo: [task1, hidden, task3] }));
    mutate.mockResolvedValue(undefined);
    renderBoard(["/?priority=high"]);

    // 前提: フィルタで低優先度カードは非表示
    expect(
      screen.queryByRole("link", { name: "TASK-2" }),
    ).not.toBeInTheDocument();

    const handlers = dndHandlers.current;
    if (!handlers) throw new Error("DndContext が描画されていません");

    // onDragStart は setActiveTask を伴う再レンダリングを起こすため、
    // onDragEnd は再レンダリング後の最新 handlers（dragged=activeTask を
    // 正しく捕捉したクロージャ）から呼び出す必要がある。
    act(() => {
      handlers.onDragStart?.({ active: { id: "task_3" } } as DragStartEvent);
    });
    const afterStart = dndHandlers.current;
    if (!afterStart) throw new Error("DndContext が描画されていません");
    await act(async () => {
      await afterStart.onDragEnd?.({
        active: { id: "task_3" },
        over: { id: "task_1" },
      } as DragEndEvent);
    });

    // task3 を可視先頭（task1 の前）へ挿入する。フル列（未フィルタ）で task1 の
    // 直前には何も無いため before=null。after=task1.rank（フル列で task1 の
    // 直後は非表示 hidden だが、挿入位置は task1 の"前"なので登場しない）。
    expect(mutate).toHaveBeenCalledWith({
      id: "task_3",
      before: null,
      after: "a0",
      expectedRevision: task3.revision,
    });
  });

  it("列またぎの移動はフル列（未フィルタ）の実隣接 rank で transitionStatus を呼ぶ（非表示カードとの rank 重複を避ける）", async () => {
    const source = createTask({
      _id: "task_1" as Id<"tasks">,
      number: 1,
      status: "todo",
      priority: "high",
      rank: "a0",
    });
    const targetVisible = createTask({
      _id: "task_2" as Id<"tasks">,
      number: 2,
      status: "in_progress",
      priority: "high",
      rank: "b0",
    });
    const targetHidden = createTask({
      _id: "task_3" as Id<"tasks">,
      number: 3,
      status: "in_progress",
      priority: "low",
      rank: "b1",
    });
    boardQuery.mockReturnValue(
      createColumns({
        todo: [source],
        in_progress: [targetVisible, targetHidden],
      }),
    );
    mutate.mockResolvedValue(undefined);
    renderBoard(["/?priority=high"]);

    expect(
      screen.queryByRole("link", { name: "TASK-3" }),
    ).not.toBeInTheDocument();

    const handlers = dndHandlers.current;
    if (!handlers) throw new Error("DndContext が描画されていません");

    // onDragStart は setActiveTask を伴う再レンダリングを起こすため、
    // onDragEnd は再レンダリング後の最新 handlers（dragged=activeTask を
    // 正しく捕捉したクロージャ）から呼び出す必要がある。
    act(() => {
      handlers.onDragStart?.({ active: { id: "task_1" } } as DragStartEvent);
      // 遷移先列の余白（列コンテナ自体）へドロップ＝可視末尾へ追加
      handlers.onDragOver?.({
        active: { id: "task_1" },
        over: { id: "in_progress" },
      } as DragOverEvent);
    });
    const afterStart = dndHandlers.current;
    if (!afterStart) throw new Error("DndContext が描画されていません");
    await act(async () => {
      await afterStart.onDragEnd?.({
        active: { id: "task_1" },
        over: { id: "in_progress" },
      } as DragEndEvent);
    });

    // 可視配列では [targetVisible, source] の末尾（targetVisible の直後）へ
    // 挿入するが、フル列（未フィルタ）では targetVisible の直後に非表示
    // targetHidden がいる。可視隣接だけ（before=targetVisible.rank,
    // after=null）で rankBetween を呼ぶと targetHidden と同一 rank を
    // 重複発行しうるため、before=targetVisible.rank, after=targetHidden.rank
    // としてその間へ挿入する。
    expect(mutate).toHaveBeenCalledWith({
      id: "task_1",
      to: "in_progress",
      before: "b0",
      after: "b1",
      expectedRevision: source.revision,
    });
  });
});

/**
 * mutation 未解決中のフィルタ変更による楽観更新の巻き戻り防止（Issue #92 修正2）。
 * moveTask/transitionStatus の await 中に URL フィルタが変わると、同期
 * effect が「columns 不変・filter 変化」で発火し、ドロップ前の古い
 * snapshot から board を再構築して楽観更新が巻き戻ってしまう回帰を防ぐ。
 * mutate の Promise を手動制御し、未解決の間は resync が起きないことを
 * DOM のカード順序で確認する。
 */
describe("Board のドロップ直後・mutation 未解決中のフィルタ変更（Issue #92）", () => {
  it("mutation が未解決の間はフィルタ変更があっても board を巻き戻さない", async () => {
    const a = createTask({
      _id: "task_1" as Id<"tasks">,
      number: 1,
      priority: "high",
      rank: "a0",
    });
    const b = createTask({
      _id: "task_2" as Id<"tasks">,
      number: 2,
      priority: "high",
      rank: "a1",
    });
    boardQuery.mockReturnValue(createColumns({ todo: [a, b] }));

    let resolveMutate: (() => void) | undefined;
    mutate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveMutate = resolve;
        }),
    );

    const { router } = renderBoardWithRouter(["/"]);
    const cardOrder = () =>
      within(getColumn(TASK_STATUS_LABELS.todo))
        .getAllByRole("link")
        .map((el) => el.textContent);

    expect(cardOrder()).toEqual(["TASK-1", "TASK-2"]);

    const handlers = dndHandlers.current;
    if (!handlers) throw new Error("DndContext が描画されていません");

    // task_1 を task_2 の後ろへ並べ替える（同一列内ドロップ）。
    // dragEnd 内の moveTask は上で差し替えた未解決 Promise を返すため、
    // 以降 await は resolveMutate() を呼ぶまで完了しない。
    act(() => {
      handlers.onDragStart?.({ active: { id: "task_1" } } as DragStartEvent);
    });
    const afterStart = dndHandlers.current;
    if (!afterStart) throw new Error("DndContext が描画されていません");

    act(() => {
      afterStart.onDragEnd?.({
        active: { id: "task_1" },
        over: { id: "task_2" },
      } as DragEndEvent);
    });

    // 楽観更新で並び順が入れ替わる（mutation は上で差し替えた未解決
    // Promise を返すため、resolveMutate() を呼ぶまで完了しない）
    expect(cardOrder()).toEqual(["TASK-2", "TASK-1"]);

    // mutation 未解決のまま URL フィルタを変更する。
    await act(async () => {
      await router.navigate("/?priority=high");
    });

    // 巻き戻り防止: pendingMutationsRef が立っている間は同期 effect が
    // resync しないため、ドロップ前の並び（server snapshot 由来）へは
    // 戻らず、楽観更新後の並びのまま維持される。
    expect(cardOrder()).toEqual(["TASK-2", "TASK-1"]);

    // mutation を解決させて後片付けする（他テストへの影響防止）。
    await act(async () => {
      resolveMutate?.();
      await Promise.resolve();
    });
  });
});

/**
 * ドラッグの直列化（Issue #92 再レビュー指摘1・2・4）。
 * moveTask/transitionStatus の await 中（pendingMutationsRef > 0）に
 * 次のドラッグが始まると、(1) neighborRanksInFullColumn へ渡す
 * fullColumn（columns スナップショット）が stale 化して rank を誤配置し、
 * (2) その状態の onDragCancel が進行中の楽観更新を巻き戻し、
 * (4) catch の resyncFromServer が別ドラッグの結果を clobber しうる。
 * mutation 未解決中に始まったドラッグを無効化（activeTask を設定しない）
 * することで in-flight mutation を常に高々1つに保ち、これらを防ぐ。
 */
describe("Board のドラッグ直列化（Issue #92 再レビュー指摘1・2・4）", () => {
  it("mutation 未解決中に開始したドラッグは無効化され、board 不変・mutation は呼ばれず、ドロップでエラーメッセージを表示する。mutation 解決後は通常どおりドラッグできる", async () => {
    const a = createTask({
      _id: "task_1" as Id<"tasks">,
      number: 1,
      rank: "a0",
    });
    const b = createTask({
      _id: "task_2" as Id<"tasks">,
      number: 2,
      rank: "a1",
    });
    boardQuery.mockReturnValue(createColumns({ todo: [a, b] }));

    let resolveMutate: (() => void) | undefined;
    mutate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveMutate = resolve;
        }),
    );

    renderBoard();
    const cardOrder = () =>
      within(getColumn(TASK_STATUS_LABELS.todo))
        .getAllByRole("link")
        .map((el) => el.textContent);

    expect(cardOrder()).toEqual(["TASK-1", "TASK-2"]);

    // 1本目: task_1 を task_2 の後ろへ並べ替える（同一列内ドロップ）。
    // mutate は未解決の Promise を返すため mutation は pending のまま。
    const handlers = dndHandlers.current;
    if (!handlers) throw new Error("DndContext が描画されていません");
    act(() => {
      handlers.onDragStart?.({ active: { id: "task_1" } } as DragStartEvent);
    });
    const afterFirstStart = dndHandlers.current;
    if (!afterFirstStart) throw new Error("DndContext が描画されていません");
    act(() => {
      afterFirstStart.onDragEnd?.({
        active: { id: "task_1" },
        over: { id: "task_2" },
      } as DragEndEvent);
    });

    expect(cardOrder()).toEqual(["TASK-2", "TASK-1"]);
    expect(mutate).toHaveBeenCalledTimes(1);

    // 2本目: 1本目が未解決のうちに開始する。onDragStart で抑止され
    // activeTask が設定されないため、onDragOver/onDragEnd を駆動しても
    // board は変化せず mutation も呼ばれない。
    const beforeSecondStart = dndHandlers.current;
    if (!beforeSecondStart) throw new Error("DndContext が描画されていません");
    act(() => {
      beforeSecondStart.onDragStart?.({
        active: { id: "task_2" },
      } as DragStartEvent);
      beforeSecondStart.onDragOver?.({
        active: { id: "task_2" },
        over: { id: "task_1" },
      } as DragOverEvent);
    });
    expect(cardOrder()).toEqual(["TASK-2", "TASK-1"]);

    act(() => {
      beforeSecondStart.onDragEnd?.({
        active: { id: "task_2" },
        over: { id: "task_1" },
      } as DragEndEvent);
    });

    expect(cardOrder()).toEqual(["TASK-2", "TASK-1"]);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(
        "直前の操作を反映しています。少し待ってからもう一度お試しください",
      ),
    ).toBeInTheDocument();

    // 1本目の mutation を解決する。
    await act(async () => {
      resolveMutate?.();
      await Promise.resolve();
    });

    // mutation 解決後は通常どおりドラッグできる。
    mutate.mockReset();
    mutate.mockResolvedValue(undefined);
    const afterResolve = dndHandlers.current;
    if (!afterResolve) throw new Error("DndContext が描画されていません");
    act(() => {
      afterResolve.onDragStart?.({
        active: { id: "task_1" },
      } as DragStartEvent);
    });
    const beforeThirdEnd = dndHandlers.current;
    if (!beforeThirdEnd) throw new Error("DndContext が描画されていません");
    await act(async () => {
      await beforeThirdEnd.onDragEnd?.({
        active: { id: "task_1" },
        over: { id: "task_2" },
      } as DragEndEvent);
    });

    expect(cardOrder()).toEqual(["TASK-1", "TASK-2"]);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("抑止中の onDragCancel は resync を起こさず、pending 中の楽観状態を維持する", () => {
    const a = createTask({
      _id: "task_1" as Id<"tasks">,
      number: 1,
      rank: "a0",
    });
    const b = createTask({
      _id: "task_2" as Id<"tasks">,
      number: 2,
      rank: "a1",
    });
    boardQuery.mockReturnValue(createColumns({ todo: [a, b] }));

    // 意図的に解決しない Promise を返す（このテストでは mutation の完了は
    // 検証対象外で、pending 状態を維持したまま onDragCancel の挙動だけを見る）。
    mutate.mockImplementation(() => new Promise<void>(() => {}));

    renderBoard();
    const cardOrder = () =>
      within(getColumn(TASK_STATUS_LABELS.todo))
        .getAllByRole("link")
        .map((el) => el.textContent);

    const handlers = dndHandlers.current;
    if (!handlers) throw new Error("DndContext が描画されていません");
    act(() => {
      handlers.onDragStart?.({ active: { id: "task_1" } } as DragStartEvent);
    });
    const afterFirstStart = dndHandlers.current;
    if (!afterFirstStart) throw new Error("DndContext が描画されていません");
    act(() => {
      afterFirstStart.onDragEnd?.({
        active: { id: "task_1" },
        over: { id: "task_2" },
      } as DragEndEvent);
    });

    expect(cardOrder()).toEqual(["TASK-2", "TASK-1"]);

    // 2本目のドラッグを開始（抑止される）、ESC などでキャンセルする。
    const beforeSecondStart = dndHandlers.current;
    if (!beforeSecondStart) throw new Error("DndContext が描画されていません");
    act(() => {
      beforeSecondStart.onDragStart?.({
        active: { id: "task_2" },
      } as DragStartEvent);
      beforeSecondStart.onDragCancel?.({
        active: { id: "task_2" },
        over: null,
      } as DragCancelEvent);
    });

    // 抑止中の cancel は resync しないため、1本目の楽観更新後の並びが
    // 巻き戻らずそのまま維持される。
    expect(cardOrder()).toEqual(["TASK-2", "TASK-1"]);
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});

/**
 * 空状態メッセージの判定基準（Issue #92 再レビュー指摘3）。
 * serverIsEmpty を live な columns から直接計算すると、board の派生元
 * スナップショット（syncedRef.current）が古いまま据え置かれている間
 * （ドラッグ中は同期 effect が activeTask で早期 return する）に、
 * live な columns だけ先に変化した場合、表示中カード（board 由来）と
 * 空状態メッセージ（columns 由来）が矛盾しうる。syncedRef.current を
 * 基準にすることでこれを防ぐ。
 */
describe("Board の空状態メッセージの基準（Issue #92 再レビュー指摘3）", () => {
  it("ドラッグ中に live な columns が0件へ変化しても、表示中カードと矛盾する『タスクがありません』は出さない", () => {
    boardQuery.mockReturnValue(createColumns({ todo: [createTask()] }));
    const { rerender } = renderBoard();

    const handlers = dndHandlers.current;
    if (!handlers) throw new Error("DndContext が描画されていません");
    act(() => {
      handlers.onDragStart?.({ active: { id: "task_1" } } as DragStartEvent);
    });

    // ドラッグ中に（他ユーザーの操作等で）live な columns が0件になった
    // とする。同期 effect は activeTask 中は早期 return するため board は
    // 再構築されず、カードは表示され続ける。
    boardQuery.mockReturnValue(createColumns());
    act(() => {
      rerender(
        <MemoryRouter>
          <Board project={"project_1" as Id<"projects">} projectKey="TASK" />
        </MemoryRouter>,
      );
    });

    expect(screen.getByRole("link", { name: "TASK-12" })).toBeInTheDocument();
    expect(screen.queryByText(/タスクがありません/)).not.toBeInTheDocument();
  });
});
