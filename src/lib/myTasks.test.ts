import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { groupMyTasks, type MyTask } from "./myTasks";

/**
 * groupMyTasks（純粋関数）の単体テスト。
 * status グルーピング（TASK_STATUS_ORDER 順・空セクション除外）と、
 * グループ内比較子（期限日→優先度→projectKey→number）を検証する。
 */

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

describe("groupMyTasks のセクション構成", () => {
  it("TASK_STATUS_ORDER 順のセクションが返り、空セクションは含まれない", () => {
    const tasks = [
      createTask({ _id: "t-done" as Id<"tasks">, status: "done" }),
      createTask({ _id: "t-backlog" as Id<"tasks">, status: "backlog" }),
      createTask({ _id: "t-todo" as Id<"tasks">, status: "todo" }),
    ];

    const sections = groupMyTasks(tasks);

    expect(sections.map((s) => s.status)).toEqual(["backlog", "todo", "done"]);
  });

  it("done/canceled のセクションも表示される", () => {
    const tasks = [
      createTask({ _id: "t-done" as Id<"tasks">, status: "done" }),
      createTask({ _id: "t-canceled" as Id<"tasks">, status: "canceled" }),
    ];

    const sections = groupMyTasks(tasks);

    expect(sections.map((s) => s.status)).toEqual(["done", "canceled"]);
  });

  it("該当 Task が無ければセクション自体を返さない", () => {
    expect(groupMyTasks([])).toEqual([]);
  });

  it("入力配列を破壊しない", () => {
    const tasks = [
      createTask({
        _id: "b" as Id<"tasks">,
        status: "todo",
        dueDate: "2026-08-10",
      }),
      createTask({
        _id: "a" as Id<"tasks">,
        status: "todo",
        dueDate: "2026-08-01",
      }),
    ];
    const originalOrder = tasks.map((t) => t._id);

    groupMyTasks(tasks);

    expect(tasks.map((t) => t._id)).toEqual(originalOrder);
  });
});

describe("groupMyTasks のグループ内ソート", () => {
  it("期限日が早い順に並ぶ", () => {
    const tasks = [
      createTask({ _id: "later" as Id<"tasks">, dueDate: "2026-08-10" }),
      createTask({ _id: "earlier" as Id<"tasks">, dueDate: "2026-08-01" }),
    ];

    const [section] = groupMyTasks(tasks);

    expect(section.tasks.map((t) => t._id)).toEqual(["earlier", "later"]);
  });

  it("期限日未設定の Task は末尾に並ぶ", () => {
    const tasks = [
      createTask({ _id: "no-due" as Id<"tasks">, dueDate: undefined }),
      createTask({ _id: "has-due" as Id<"tasks">, dueDate: "2026-08-01" }),
    ];

    const [section] = groupMyTasks(tasks);

    expect(section.tasks.map((t) => t._id)).toEqual(["has-due", "no-due"]);
  });

  it("同一期限日なら優先度が高い順に並ぶ", () => {
    const tasks = [
      createTask({
        _id: "low" as Id<"tasks">,
        dueDate: "2026-08-01",
        priority: "low",
      }),
      createTask({
        _id: "urgent" as Id<"tasks">,
        dueDate: "2026-08-01",
        priority: "urgent",
      }),
    ];

    const [section] = groupMyTasks(tasks);

    expect(section.tasks.map((t) => t._id)).toEqual(["urgent", "low"]);
  });

  it("期限日・優先度が同じなら projectKey→number 順に並ぶ", () => {
    const tasks = [
      createTask({
        _id: "web-1" as Id<"tasks">,
        dueDate: "2026-08-01",
        priority: "none",
        projectKey: "WEB",
        number: 1,
      }),
      createTask({
        _id: "task-2" as Id<"tasks">,
        dueDate: "2026-08-01",
        priority: "none",
        projectKey: "TASK",
        number: 2,
      }),
      createTask({
        _id: "task-1" as Id<"tasks">,
        dueDate: "2026-08-01",
        priority: "none",
        projectKey: "TASK",
        number: 1,
      }),
    ];

    const [section] = groupMyTasks(tasks);

    expect(section.tasks.map((t) => t._id)).toEqual([
      "task-1",
      "task-2",
      "web-1",
    ]);
  });
});
