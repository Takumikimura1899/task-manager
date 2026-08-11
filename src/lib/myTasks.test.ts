import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { groupMyTasksByDueDate, type MyTask } from "./myTasks";

/**
 * groupMyTasksByDueDate（純粋関数）の単体テスト。
 * 期限軸のバケット判定（境界値・today 引数化）、done/canceled の除外、
 * 空バケットの除外、グループ内比較子（期限日→優先度→projectKey→number）を
 * 検証する。today は "2026-08-11" に固定する。
 */

const TODAY = "2026-08-11";

const createTask = (overrides: Partial<MyTask> = {}): MyTask => ({
  _id: "task_1" as Id<"tasks">,
  _creationTime: 1000,
  issue: "issue_1" as Id<"issues">,
  project: "project_1" as Id<"projects">,
  number: 1,
  title: "タスク",
  status: "todo",
  priority: "none",
  rank: "a0",
  createdBy: "member_1" as Id<"members">,
  revision: 1,
  updatedAt: 1000,
  projectKey: "TASK",
  issueNumber: 1,
  ...overrides,
});

describe("groupMyTasksByDueDate のバケット判定", () => {
  it("today 前日は期限切れになる", () => {
    const tasks = [createTask({ dueDate: "2026-08-10" })];

    const groups = groupMyTasksByDueDate(tasks, TODAY);

    expect(groups.map((g) => g.bucket)).toEqual(["overdue"]);
  });

  it("today 当日は今日になる", () => {
    const tasks = [createTask({ dueDate: "2026-08-11" })];

    const groups = groupMyTasksByDueDate(tasks, TODAY);

    expect(groups.map((g) => g.bucket)).toEqual(["today"]);
  });

  it("today+1〜today+7 は今後7日になる（境界値）", () => {
    const tasks = [
      createTask({ _id: "d12" as Id<"tasks">, dueDate: "2026-08-12" }),
      createTask({ _id: "d18" as Id<"tasks">, dueDate: "2026-08-18" }),
    ];

    const groups = groupMyTasksByDueDate(tasks, TODAY);

    expect(groups.map((g) => g.bucket)).toEqual(["next7"]);
    expect(groups[0]?.tasks.map((t) => t._id)).toEqual(["d12", "d18"]);
  });

  it("today+8 以降はそれ以降になる", () => {
    const tasks = [createTask({ dueDate: "2026-08-19" })];

    const groups = groupMyTasksByDueDate(tasks, TODAY);

    expect(groups.map((g) => g.bucket)).toEqual(["later"]);
  });

  it("期限日未設定は期限なしになる", () => {
    const tasks = [createTask({ dueDate: undefined })];

    const groups = groupMyTasksByDueDate(tasks, TODAY);

    expect(groups.map((g) => g.bucket)).toEqual(["noDue"]);
  });

  it("該当バケットが無ければグループ自体を返さない", () => {
    expect(groupMyTasksByDueDate([], TODAY)).toEqual([]);
  });

  it("複数バケットが混在する場合は DUE_BUCKET_ORDER 順で返る", () => {
    const tasks = [
      createTask({ _id: "no-due" as Id<"tasks">, dueDate: undefined }),
      createTask({ _id: "later" as Id<"tasks">, dueDate: "2026-08-19" }),
      createTask({ _id: "today" as Id<"tasks">, dueDate: "2026-08-11" }),
      createTask({ _id: "overdue" as Id<"tasks">, dueDate: "2026-08-01" }),
      createTask({ _id: "next7" as Id<"tasks">, dueDate: "2026-08-15" }),
    ];

    const groups = groupMyTasksByDueDate(tasks, TODAY);

    expect(groups.map((g) => g.bucket)).toEqual([
      "overdue",
      "today",
      "next7",
      "later",
      "noDue",
    ]);
  });
});

describe("groupMyTasksByDueDate の done/canceled 除外", () => {
  it("done と canceled の Task は表示対象から除く", () => {
    const tasks = [
      createTask({ _id: "done" as Id<"tasks">, status: "done" }),
      createTask({ _id: "canceled" as Id<"tasks">, status: "canceled" }),
      createTask({ _id: "todo" as Id<"tasks">, status: "todo" }),
    ];

    const groups = groupMyTasksByDueDate(tasks, TODAY);

    const allIds = groups.flatMap((g) => g.tasks.map((t) => t._id));
    expect(allIds).toEqual(["todo"]);
  });

  it("done/canceled しか無ければ空配列を返す", () => {
    const tasks = [
      createTask({ _id: "done" as Id<"tasks">, status: "done" }),
      createTask({ _id: "canceled" as Id<"tasks">, status: "canceled" }),
    ];

    expect(groupMyTasksByDueDate(tasks, TODAY)).toEqual([]);
  });
});

describe("groupMyTasksByDueDate の入力保護", () => {
  it("入力配列を破壊しない", () => {
    const tasks = [
      createTask({ _id: "b" as Id<"tasks">, dueDate: "2026-08-10" }),
      createTask({ _id: "a" as Id<"tasks">, dueDate: "2026-08-01" }),
    ];
    const originalOrder = tasks.map((t) => t._id);

    groupMyTasksByDueDate(tasks, TODAY);

    expect(tasks.map((t) => t._id)).toEqual(originalOrder);
  });
});

describe("groupMyTasksByDueDate のグループ内ソート", () => {
  it("期限日が早い順に並ぶ", () => {
    const tasks = [
      createTask({ _id: "later" as Id<"tasks">, dueDate: "2026-08-18" }),
      createTask({ _id: "earlier" as Id<"tasks">, dueDate: "2026-08-12" }),
    ];

    const [group] = groupMyTasksByDueDate(tasks, TODAY);

    expect(group?.tasks.map((t) => t._id)).toEqual(["earlier", "later"]);
  });

  it("期限日未設定の Task は末尾に並ぶ（期限なしバケット内）", () => {
    const tasks = [
      createTask({ _id: "no-due-2" as Id<"tasks">, dueDate: undefined }),
      createTask({ _id: "no-due-1" as Id<"tasks">, dueDate: undefined }),
    ];

    const [group] = groupMyTasksByDueDate(tasks, TODAY);

    expect(group?.bucket).toBe("noDue");
    expect(group?.tasks).toHaveLength(2);
  });

  it("同一期限日なら優先度が高い順に並ぶ", () => {
    const tasks = [
      createTask({
        _id: "low" as Id<"tasks">,
        dueDate: "2026-08-12",
        priority: "low",
      }),
      createTask({
        _id: "urgent" as Id<"tasks">,
        dueDate: "2026-08-12",
        priority: "urgent",
      }),
    ];

    const [group] = groupMyTasksByDueDate(tasks, TODAY);

    expect(group?.tasks.map((t) => t._id)).toEqual(["urgent", "low"]);
  });

  it("期限日・優先度が同じなら projectKey→number 順に並ぶ", () => {
    const tasks = [
      createTask({
        _id: "web-1" as Id<"tasks">,
        dueDate: "2026-08-12",
        priority: "none",
        projectKey: "WEB",
        number: 1,
      }),
      createTask({
        _id: "task-2" as Id<"tasks">,
        dueDate: "2026-08-12",
        priority: "none",
        projectKey: "TASK",
        number: 2,
      }),
      createTask({
        _id: "task-1" as Id<"tasks">,
        dueDate: "2026-08-12",
        priority: "none",
        projectKey: "TASK",
        number: 1,
      }),
    ];

    const [group] = groupMyTasksByDueDate(tasks, TODAY);

    expect(group?.tasks.map((t) => t._id)).toEqual([
      "task-1",
      "task-2",
      "web-1",
    ]);
  });
});
