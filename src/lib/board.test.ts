import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import {
  applyBoardFilter,
  type BoardColumn,
  type BoardTask,
  insertAnchor,
  pickCardFirstCollisions,
  pickPointerScopedCollisions,
  resolveSameColumnTargetIndex,
} from "./board";
import { EMPTY_FILTER, type FilterState } from "./filterParams";
import type { TaskStatus } from "./taskMeta";

const createTask = (overrides: Partial<BoardTask> = {}): BoardTask => ({
  _id: "task_1" as Id<"tasks">,
  _creationTime: 1000,
  issue: "issue_1" as Id<"issues">,
  project: "project_1" as Id<"projects">,
  number: 1,
  title: "タスク",
  status: "todo",
  priority: "high",
  rank: "a0",
  createdBy: "member_1" as Id<"members">,
  revision: 1,
  updatedAt: 1000,
  issueNumber: 1,
  assigneeName: null,
  ...overrides,
});

/** テスト用の id 文字列でラップする（衝突検出の入力形状 `{ id }` に揃える）。 */
const wrap = (ids: readonly string[]) => ids.map((id) => ({ id }));

/** 空の BoardColumn を組み立てる。 */
const createColumn = (
  status: TaskStatus,
  tasks: BoardTask[] = [],
): BoardColumn => ({ status, tasks });

/**
 * pickPointerScopedCollisions のテスト用フィクスチャ：
 * task1/task2 は in_progress 列、task9 は in_review 列に属する。
 */
const columnOfCard = (id: string) =>
  id === "task9" ? "in_review" : id.startsWith("task") ? "in_progress" : null;

/**
 * ドロップ位置の可視アンカーから move / transitionStatus へ渡す position
 * （アンカー taskId）を導く。実際の rank 計算・フル列における実隣接の解決は
 * サーバー側（convex/tasks.ts の rankForInsert）が担うため、ここでは
 * 「どちらのアンカーを・どちらのキーで返すか」の分岐だけを検証する
 * （フル列との重複防止テストは convex/tasks.test.ts へ移設済み）。
 */
describe("insertAnchor", () => {
  const prev = createTask({ _id: "prev" as Id<"tasks"> });
  const next = createTask({ _id: "next" as Id<"tasks"> });

  it("visiblePrev があれば afterTask（prev の直後）を返す", () => {
    expect(insertAnchor(prev, null)).toEqual({ afterTask: "prev" });
  });

  it("visiblePrev が無く visibleNext があれば beforeTask（next の直前）を返す", () => {
    expect(insertAnchor(null, next)).toEqual({ beforeTask: "next" });
  });

  it("どちらも無ければ undefined（末尾。サーバーが lastRankInColumn へ委譲する）", () => {
    expect(insertAnchor(null, null)).toBeUndefined();
  });

  it("prev と next 両方あるときは prev を優先する（非対称仕様の固定）", () => {
    expect(insertAnchor(prev, next)).toEqual({ afterTask: "prev" });
  });
});

/**
 * 同一列内ドロップの移動先解決を検証する。
 * over が列コンテナ（overIndex === -1）のときは末尾へフォールバックし、
 * 位置が変わらないドロップは null（no-op）になることを確認する。
 */
describe("resolveSameColumnTargetIndex", () => {
  it.each([
    // [ケース, oldIndex, overIndex, taskCount, expected]
    ["タスク上へのドロップは overIndex へ移動", 0, 2, 3, 2],
    ["列コンテナへのドロップは末尾へフォールバック", 0, -1, 3, 2],
    ["同じ位置へのドロップは no-op", 1, 1, 3, null],
    ["末尾タスクを列コンテナに落とすと no-op（既に末尾）", 2, -1, 3, null],
    ["要素が1つの列で列コンテナに落とすと no-op", 0, -1, 1, null],
    ["移動元が見つからない場合は no-op", -1, -1, 3, null],
  ])("%s", (_case, oldIndex, overIndex, taskCount, expected) => {
    expect(resolveSameColumnTargetIndex(oldIndex, overIndex, taskCount)).toBe(
      expected,
    );
  });
});

/**
 * 衝突検出のカード優先選択を検証する。
 * over が列コンテナに解決されると末尾フォールバックが誤発動するため、
 * どこかの段階でカードに当たっていれば必ずカードが選ばれること、
 * 特に「先頭段階が列のみでも後続段階のカードを採用する」
 * （＝カード間の隙間へのドロップの誤判定防止）を確認する。
 */
describe("pickCardFirstCollisions", () => {
  const columnIds: ReadonlySet<string> = new Set(["backlog", "todo"]);

  it.each([
    // [ケース, 段階ごとの衝突id列, 期待する出力id列]
    [
      "先頭段階にカードと列が混在したらカードのみ返す",
      [["backlog", "task1", "task2"]],
      ["task1", "task2"],
    ],
    [
      "先頭段階が列のみでも後続段階のカードを採用する（カード間の隙間）",
      [["backlog"], ["task1", "backlog"], ["task2"]],
      ["task1"],
    ],
    [
      "全段階にカードが無ければ最初に衝突があった段階の列を返す（余白へのドロップ）",
      [[], ["backlog"], ["todo"]],
      ["backlog"],
    ],
    ["全段階が空なら空を返す", [[], [], []], []],
  ])("%s", (_case, stageIds, expected) => {
    const stages = stageIds.map((ids) => ids.map((id) => ({ id })));
    expect(pickCardFirstCollisions(stages, columnIds)).toEqual(
      expected.map((id) => ({ id })),
    );
  });
});

/**
 * ポインタのいる列にスコープしたカード優先解決を検証する（#65）。
 * ハンドルドラッグではポインタが隣列に入ってもカード矩形が元列に残るため、
 * 元列のカード（rectIntersection のヒット）が over を奪わないことを確認する。
 */
describe("pickPointerScopedCollisions", () => {
  const columnIds: ReadonlySet<string> = new Set(["in_progress", "in_review"]);

  it.each([
    // [ケース, pointerHits, rectHits, 期待（null=フォールバック委譲）]
    [
      "ポインタがカード上ならそのカードを返す",
      ["in_progress", "task1"],
      ["task1", "task2", "in_progress"],
      ["task1"],
    ],
    [
      "ポインタが列内の隙間なら rect ヒットのうちその列のカードだけ返す（#53維持）",
      ["in_progress"],
      ["task1", "task2", "in_progress"],
      ["task1", "task2"],
    ],
    [
      "ポインタが移動先列にあれば元列カードの rect ヒットを無視して列を返す（#65）",
      ["in_review"],
      ["task1", "task2", "in_progress"],
      ["in_review"],
    ],
    [
      "ポインタが移動先列にあり、その列のカードが rect に含まれればカードを返す",
      ["in_review"],
      ["task1", "task9", "in_review"],
      ["task9"],
    ],
    [
      "ポインタが空列の余白にあれば列を返す（#14維持）",
      ["in_review"],
      ["in_review"],
      ["in_review"],
    ],
    [
      "ポインタ情報が無ければ null（キーボード操作のフォールバック委譲）",
      [],
      ["task1"],
      null,
    ],
  ])("%s", (_case, pointerIds, rectIds, expected) => {
    expect(
      pickPointerScopedCollisions(
        wrap(pointerIds),
        wrap(rectIds),
        columnIds,
        columnOfCard,
      ),
    ).toEqual(expected === null ? null : wrap(expected));
  });
});

/**
 * カンバンのフィルタ派生（Issue #92）を検証する。
 * board 派生の全経路（同期 effect / dragCancel / dragEnd の catch）が
 * この純粋関数を通るため、ここでは列構造の保持と priority/assignee の
 * AND 絞り込みだけを純粋関数として検証する。
 */
describe("applyBoardFilter", () => {
  it("priority/assignee が両方 null なら入力をそのまま返す", () => {
    const columns = [createColumn("todo", [createTask()])];
    expect(applyBoardFilter(columns, EMPTY_FILTER)).toBe(columns);
  });

  it("priority のみ指定時はその優先度のタスクだけ残す", () => {
    const high = createTask({ _id: "t1" as Id<"tasks">, priority: "high" });
    const low = createTask({ _id: "t2" as Id<"tasks">, priority: "low" });
    const columns = [createColumn("todo", [high, low])];
    const filter: FilterState = { ...EMPTY_FILTER, priority: "high" };

    expect(applyBoardFilter(columns, filter)).toEqual([
      { status: "todo", tasks: [high] },
    ]);
  });

  it("assignee のみ指定時はその担当者のタスクだけ残す（未アサインは除外）", () => {
    const mine = createTask({
      _id: "t1" as Id<"tasks">,
      assignee: "member_1" as Id<"members">,
    });
    const others = createTask({
      _id: "t2" as Id<"tasks">,
      assignee: "member_2" as Id<"members">,
    });
    const unassigned = createTask({
      _id: "t3" as Id<"tasks">,
      assignee: undefined,
    });
    const columns = [createColumn("todo", [mine, others, unassigned])];
    const filter: FilterState = {
      ...EMPTY_FILTER,
      assignee: "member_1" as Id<"members">,
    };

    expect(applyBoardFilter(columns, filter)).toEqual([
      { status: "todo", tasks: [mine] },
    ]);
  });

  it("priority/assignee 両方指定時は AND で絞り込む", () => {
    const match = createTask({
      _id: "t1" as Id<"tasks">,
      priority: "high",
      assignee: "member_1" as Id<"members">,
    });
    const wrongPriority = createTask({
      _id: "t2" as Id<"tasks">,
      priority: "low",
      assignee: "member_1" as Id<"members">,
    });
    const wrongAssignee = createTask({
      _id: "t3" as Id<"tasks">,
      priority: "high",
      assignee: "member_2" as Id<"members">,
    });
    const columns = [
      createColumn("todo", [match, wrongPriority, wrongAssignee]),
    ];
    const filter: FilterState = {
      status: null,
      priority: "high",
      assignee: "member_1" as Id<"members">,
    };

    expect(applyBoardFilter(columns, filter)).toEqual([
      { status: "todo", tasks: [match] },
    ]);
  });

  it("列構造（status）を保持する。全件除外された列も空配列で残る", () => {
    const todoTask = createTask({
      _id: "t1" as Id<"tasks">,
      status: "todo",
      priority: "high",
    });
    const doneTask = createTask({
      _id: "t2" as Id<"tasks">,
      status: "done",
      priority: "low",
    });
    const columns = [
      createColumn("todo", [todoTask]),
      createColumn("done", [doneTask]),
    ];
    const filter: FilterState = { ...EMPTY_FILTER, priority: "high" };

    expect(applyBoardFilter(columns, filter)).toEqual([
      { status: "todo", tasks: [todoTask] },
      { status: "done", tasks: [] },
    ]);
  });
});
