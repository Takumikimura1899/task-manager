// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  TEST_REPO_REMOTE_URL,
  TEST_WEBHOOK_ENCRYPTION_KEY,
  getTask,
  seedGhostMember,
  seedGitLink,
  seedMember,
  seedProject,
  seedRepository,
  type T,
} from "../test/convexSupport";

/**
 * Task Core ミューテーションの結合テスト（基本設計書 §3/§4/§5）。
 *
 * 純粋関数（状態機械・採番・rank）は lib/*.test.ts で単体検証済み。
 * ここでは「ミューテーションが不変条件を正しく結線しているか」を、
 * 観測可能な最終状態（DB のドキュメント）で検証する（古典学派・結合テスト層）。
 * DB は convex-test のインメモリ実装で、Core ロジックを実物で通す。
 * seedProject / seedMember / getTask は test/convexSupport.ts に一元化。
 */

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const setup = () => convexTest(schema, modules);

/**
 * Task を取得し、存在（非 null）を表明してから素のドキュメントを返す。
 * アサーションで `?.` を使うと、Task が消失していても `undefined` 経由で
 * 検証が通り抜ける偽陽性が起きうるため、フィールド検証の前に null を弾く。
 */
const loadTask = async (t: T, id: Id<"tasks">) => {
  const task = await getTask(t, id);
  expect(task).not.toBeNull();
  return task!;
};

/** Issue と最初の Task を Core API 経由で作成する（INVARIANT-5 を尊重）。 */
const seedIssueWithTask = (
  t: T,
  project: Id<"projects">,
  createdBy: Id<"members">,
) =>
  t.mutation(api.issues.create, {
    project,
    title: "課題",
    createdBy,
    firstTask: { title: "最初のタスク" },
  });

/** 指定列（status）の Task を rank 昇順（＝ボード表示順）に number で返す。 */
const columnNumbers = async (
  t: T,
  project: Id<"projects">,
  status: Doc<"tasks">["status"],
): Promise<number[]> => {
  const board = await t.query(api.tasks.board, { project });
  const column = board.find((c) => c.status === status);
  return (column?.tasks ?? []).map((task) => task.number);
};

// --- create -----------------------------------------------------------------

describe("tasks.create", () => {
  it("Issue 配下に backlog 列の Task を採番して作成し、採番カウンタを進める", async () => {
    const t = setup();
    const project = await seedProject(t);
    const member = await seedMember(t);
    // issues.create が number=1 の Task とカウンタ前進(→2)を消費している
    const { issue } = await seedIssueWithTask(t, project, member);

    const taskId = await t.mutation(api.tasks.create, {
      issue,
      title: "2つ目のタスク",
      createdBy: member,
    });

    const task = await getTask(t, taskId);
    expect(task).toMatchObject({
      issue,
      project, // issue から解決した冗長参照が一致する（INVARIANT-5）
      number: 2, // 最初の Task が 1 を消費済み（INVARIANT-1）
      status: "backlog",
      priority: "none",
      revision: 0,
    });

    // 採番カウンタが次番号(3)まで進んでいる
    const proj = await t.run((ctx) => ctx.db.get(project));
    expect(proj?.nextTaskNumber).toBe(3);
  });

  it("存在しない Issue を指定すると拒否する（参照整合性）", async () => {
    const t = setup();
    const project = await seedProject(t);
    const member = await seedMember(t);
    const { issue } = await seedIssueWithTask(t, project, member);
    await t.run((ctx) => ctx.db.delete(issue)); // 参照だけ残して実体を消す

    await expect(
      t.mutation(api.tasks.create, { issue, title: "x", createdBy: member }),
    ).rejects.toThrowError("Issue が存在しません");
  });

  it("存在しない createdBy を指定すると拒否する（参照整合性）", async () => {
    const t = setup();
    const project = await seedProject(t);
    const member = await seedMember(t);
    const { issue } = await seedIssueWithTask(t, project, member);
    const ghost = await seedGhostMember(t);

    await expect(
      t.mutation(api.tasks.create, { issue, title: "x", createdBy: ghost }),
    ).rejects.toThrowError("メンバーが存在しません");
  });
});

// --- transitionStatus -------------------------------------------------------

describe("tasks.transitionStatus", () => {
  it("状態機械が許す前進遷移を適用し revision を進める", async () => {
    const t = setup();
    const project = await seedProject(t);
    const member = await seedMember(t);
    const { task } = await seedIssueWithTask(t, project, member);

    await t.mutation(api.tasks.transitionStatus, {
      id: task,
      to: "todo",
      expectedRevision: 0,
    });

    const after = await loadTask(t, task);
    expect(after.status).toBe("todo");
    expect(after.revision).toBe(1);
  });

  it("状態機械が許さない遷移（backlog→done）を拒否する（INVARIANT-4）", async () => {
    const t = setup();
    const project = await seedProject(t);
    const member = await seedMember(t);
    const { task } = await seedIssueWithTask(t, project, member);

    await expect(
      t.mutation(api.tasks.transitionStatus, {
        id: task,
        to: "done",
        expectedRevision: 0,
      }),
    ).rejects.toThrowError("状態遷移できません");
  });

  it("in_review → in_progress の差し戻しを許可する", async () => {
    const t = setup();
    const project = await seedProject(t);
    const member = await seedMember(t);
    const { task } = await seedIssueWithTask(t, project, member);

    // backlog → todo → in_progress → in_review まで前進させる
    let rev = 0;
    for (const to of ["todo", "in_progress", "in_review"] as const) {
      await t.mutation(api.tasks.transitionStatus, {
        id: task,
        to,
        expectedRevision: rev,
      });
      rev += 1;
    }

    await t.mutation(api.tasks.transitionStatus, {
      id: task,
      to: "in_progress",
      expectedRevision: rev,
    });

    expect((await loadTask(t, task)).status).toBe("in_progress");
  });

  it("古い revision での更新を競合として検出し拒否する（INVARIANT-2 楽観ロック）", async () => {
    const t = setup();
    const project = await seedProject(t);
    const member = await seedMember(t);
    const { task } = await seedIssueWithTask(t, project, member);

    // 1回目で revision が 0→1 に進む
    await t.mutation(api.tasks.transitionStatus, {
      id: task,
      to: "todo",
      expectedRevision: 0,
    });

    // 同じ revision=0 で再度更新しようとすると競合
    await expect(
      t.mutation(api.tasks.transitionStatus, {
        id: task,
        to: "in_progress",
        expectedRevision: 0,
      }),
    ).rejects.toThrowError("競合");
  });
});

// --- move / 位置指定遷移（D&D 並べ替え・OrderedRank, §3） --------------------

describe("tasks の並べ替え（rank・D&D スコープ）", () => {
  /** backlog に Task を3件並べ、それぞれの id を作成順（rank 昇順）で返す。 */
  const seedThreeBacklogTasks = async (t: T) => {
    const project = await seedProject(t);
    const member = await seedMember(t);
    const { issue, task: a } = await seedIssueWithTask(t, project, member);
    const b = await t.mutation(api.tasks.create, {
      issue,
      title: "B",
      createdBy: member,
    });
    const c = await t.mutation(api.tasks.create, {
      issue,
      title: "C",
      createdBy: member,
    });
    return { project, member, a, b, c };
  };

  it("move は before/after の間へ rank を割り当て、列の並びを入れ替える", async () => {
    const t = setup();
    const { project, a, b, c } = await seedThreeBacklogTasks(t);

    // 初期の backlog 並びは作成順 [1(a), 2(b), 3(c)]
    expect(await columnNumbers(t, project, "backlog")).toEqual([1, 2, 3]);

    const aRank = (await loadTask(t, a)).rank;
    const bRank = (await loadTask(t, b)).rank;

    // c を a と b の間へ移動（before=a, after=b）
    await t.mutation(api.tasks.move, {
      id: c,
      before: aRank,
      after: bRank,
      expectedRevision: 0,
    });

    // 並びは [a, c, b] = [1, 3, 2] になり、c の rank は厳密に a と b の間
    expect(await columnNumbers(t, project, "backlog")).toEqual([1, 3, 2]);
    const moved = await loadTask(t, c);
    expect(aRank < moved.rank && moved.rank < bRank).toBe(true);
    expect(moved.revision).toBe(1);
  });

  it("move は先頭（before=null）へ移動でき、列の先頭に来る", async () => {
    const t = setup();
    const { project, a, c } = await seedThreeBacklogTasks(t);

    // c を先頭へ移動。先頭に来るには「現在の先頭（a）の前」= after に a の rank を渡す。
    // before=null は先頭より前（左端）を意味し、rankBetween(null, aRank) で a より前の rank になる。
    const aRank = (await loadTask(t, a)).rank;
    await t.mutation(api.tasks.move, {
      id: c,
      before: null,
      after: aRank,
      expectedRevision: 0,
    });

    // 並びは [c, a, b] = [3, 1, 2] になり、c が列の先頭に来る。
    // order[0] のみだと a/b の相対順序の破壊を見逃すため、全順序で検証する。
    const order = await columnNumbers(t, project, "backlog");
    expect(order).toEqual([3, 1, 2]);
  });

  it("transitionStatus は列をまたいで before/after の間へ挿入する（D&D ドロップ位置・#8）", async () => {
    const t = setup();
    const { project, a, b, c } = await seedThreeBacklogTasks(t);

    // a, b を todo 列へ末尾追加 → todo は [a, b]
    await t.mutation(api.tasks.transitionStatus, {
      id: a,
      to: "todo",
      expectedRevision: 0,
    });
    await t.mutation(api.tasks.transitionStatus, {
      id: b,
      to: "todo",
      expectedRevision: 0,
    });
    expect(await columnNumbers(t, project, "todo")).toEqual([1, 2]);

    const aRank = (await loadTask(t, a)).rank;
    const bRank = (await loadTask(t, b)).rank;

    // c を backlog から todo の a・b の間へドロップ
    await t.mutation(api.tasks.transitionStatus, {
      id: c,
      to: "todo",
      expectedRevision: 0,
      before: aRank,
      after: bRank,
    });

    // todo は [a, c, b] = [1, 3, 2]、c は todo へ移り backlog から消える
    expect(await columnNumbers(t, project, "todo")).toEqual([1, 3, 2]);
    expect(await columnNumbers(t, project, "backlog")).toEqual([]);
    expect((await loadTask(t, c)).status).toBe("todo");
  });

  it("位置指定なしの transitionStatus は遷移先列の末尾に置く", async () => {
    const t = setup();
    const { project, a, b } = await seedThreeBacklogTasks(t);

    // a を todo へ（末尾）→ 続いて b を todo へ（末尾）→ [a, b]
    await t.mutation(api.tasks.transitionStatus, {
      id: a,
      to: "todo",
      expectedRevision: 0,
    });
    await t.mutation(api.tasks.transitionStatus, {
      id: b,
      to: "todo",
      expectedRevision: 0,
    });

    expect(await columnNumbers(t, project, "todo")).toEqual([1, 2]);
  });
});

// --- assign -----------------------------------------------------------------

describe("tasks.assign", () => {
  it("担当者を割り当て、null で解除できる", async () => {
    const t = setup();
    const project = await seedProject(t);
    const member = await seedMember(t);
    const assignee = await seedMember(t, {
      name: "Bob",
      email: "bob@example.com",
    });
    const { task } = await seedIssueWithTask(t, project, member);

    await t.mutation(api.tasks.assign, {
      id: task,
      assignee,
      expectedRevision: 0,
    });
    expect((await loadTask(t, task)).assignee).toBe(assignee);

    await t.mutation(api.tasks.assign, {
      id: task,
      assignee: null,
      expectedRevision: 1,
    });
    expect((await loadTask(t, task)).assignee).toBeUndefined();
  });

  it("存在しないメンバーの割り当てを拒否する", async () => {
    const t = setup();
    const project = await seedProject(t);
    const member = await seedMember(t);
    const ghost = await seedGhostMember(t);
    const { task } = await seedIssueWithTask(t, project, member);

    await expect(
      t.mutation(api.tasks.assign, {
        id: task,
        assignee: ghost,
        expectedRevision: 0,
      }),
    ).rejects.toThrowError("メンバーが存在しません");
  });
});

// --- deleteTask -------------------------------------------------------------

describe("tasks.deleteTask", () => {
  it("Issue の最後の Task の削除を拒否する（INVARIANT-5 最低基数）", async () => {
    const t = setup();
    const project = await seedProject(t);
    const member = await seedMember(t);
    const { task } = await seedIssueWithTask(t, project, member);

    await expect(
      t.mutation(api.tasks.deleteTask, { id: task, expectedRevision: 0 }),
    ).rejects.toThrowError("最後の Task は削除できません");

    // 実際に残っていることを確認
    expect(await getTask(t, task)).not.toBeNull();
  });

  it("兄弟 Task があれば削除し、関連 GitLink も併せて削除する（参照整合性）", async () => {
    const t = setup();
    const project = await seedProject(t);
    const member = await seedMember(t);
    const { issue, task: first } = await seedIssueWithTask(t, project, member);
    const second = await t.mutation(api.tasks.create, {
      issue,
      title: "2つ目",
      createdBy: member,
    });

    // first に GitLink をぶら下げておく
    const repository = await t.run((ctx) =>
      ctx.db.insert("repositories", {
        project,
        provider: "github",
        remoteUrl: "https://github.com/acme/repo",
        webhookSecret: "s",
      }),
    );
    const link = await t.run((ctx) =>
      ctx.db.insert("gitLinks", {
        task: first,
        repository,
        type: "branch",
        externalRef: "TASK-1",
        url: "https://github.com/acme/repo/tree/TASK-1",
      }),
    );

    await t.mutation(api.tasks.deleteTask, { id: first, expectedRevision: 0 });

    expect(await getTask(t, first)).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(link))).toBeNull(); // GitLink も消える
    expect(await getTask(t, second)).not.toBeNull(); // 兄弟は残る
  });

  it("古い revision での削除を競合として拒否する（楽観ロック）", async () => {
    const t = setup();
    const project = await seedProject(t);
    const member = await seedMember(t);
    const { issue, task: first } = await seedIssueWithTask(t, project, member);
    await t.mutation(api.tasks.create, {
      issue,
      title: "2つ目",
      createdBy: member,
    });

    // revision を進めておく
    await t.mutation(api.tasks.transitionStatus, {
      id: first,
      to: "todo",
      expectedRevision: 0,
    });

    await expect(
      t.mutation(api.tasks.deleteTask, { id: first, expectedRevision: 0 }),
    ).rejects.toThrowError("競合");
  });
});

// --- updateFields -------------------------------------------------------------

describe("tasks.updateFields", () => {
  it("指定したフィールドのみ更新し、revision を進める", async () => {
    const t = setup();
    const project = await seedProject(t);
    const member = await seedMember(t);
    const { issue, task } = await t.mutation(api.issues.create, {
      project,
      title: "課題",
      createdBy: member,
      firstTask: {
        title: "元のタイトル",
        description: "元の説明",
        priority: "low",
      },
    });

    await t.mutation(api.tasks.updateFields, {
      id: task,
      expectedRevision: 0,
      title: "新しいタイトル",
      priority: "urgent",
    });

    const after = await loadTask(t, task);
    expect(after).toMatchObject({
      title: "新しいタイトル",
      priority: "urgent",
      description: "元の説明", // 未指定フィールドは保持される
      issue,
      status: "backlog", // status/assignee/rank は本 mutation の対象外
      revision: 1,
    });
  });

  it("古い revision での更新を競合として拒否し、フィールドを変更しない（楽観ロック）", async () => {
    const t = setup();
    const project = await seedProject(t);
    const member = await seedMember(t);
    const { task } = await seedIssueWithTask(t, project, member);

    // revision を 0→1 に進めておく
    await t.mutation(api.tasks.updateFields, {
      id: task,
      expectedRevision: 0,
      title: "1回目の更新",
    });

    await expect(
      t.mutation(api.tasks.updateFields, {
        id: task,
        expectedRevision: 0, // 古い revision
        title: "競合する更新",
      }),
    ).rejects.toThrowError("競合");

    expect((await loadTask(t, task)).title).toBe("1回目の更新");
  });

  it("存在しないタスクを拒否する", async () => {
    const t = setup();
    const project = await seedProject(t);
    const member = await seedMember(t);
    const { issue, task } = await seedIssueWithTask(t, project, member);
    await t.mutation(api.issues.remove, { id: issue, expectedRevision: 0 });

    await expect(
      t.mutation(api.tasks.updateFields, {
        id: task,
        expectedRevision: 0,
        title: "x",
      }),
    ).rejects.toThrowError("タスクが見つかりません");
  });

  it("estimate / actual を設定でき、getDetail / board の返却に反映される", async () => {
    const t = setup();
    const project = await seedProject(t, { key: "TASK" });
    const member = await seedMember(t);
    const { task } = await seedIssueWithTask(t, project, member);

    await t.mutation(api.tasks.updateFields, {
      id: task,
      expectedRevision: 0,
      estimate: 8,
      actual: 3.5,
    });

    expect(await loadTask(t, task)).toMatchObject({
      estimate: 8,
      actual: 3.5,
      revision: 1,
    });

    const detail = await t.query(api.tasks.getDetail, {
      projectKey: "TASK",
      number: 1,
    });
    expect(detail).toMatchObject({ estimate: 8, actual: 3.5 });

    const board = await t.query(api.tasks.board, { project });
    const backlog = board.find((column) => column.status === "backlog")!;
    expect(backlog.tasks).toMatchObject([{ estimate: 8, actual: 3.5 }]);
  });

  it("estimate / actual に null を指定するとクリアされる（DB 上 undefined）", async () => {
    const t = setup();
    const project = await seedProject(t);
    const member = await seedMember(t);
    const { task } = await seedIssueWithTask(t, project, member);

    await t.mutation(api.tasks.updateFields, {
      id: task,
      expectedRevision: 0,
      estimate: 8,
      actual: 3,
    });
    await t.mutation(api.tasks.updateFields, {
      id: task,
      expectedRevision: 1,
      estimate: null,
      actual: null,
    });

    const after = await loadTask(t, task);
    expect(after.estimate).toBeUndefined();
    expect(after.actual).toBeUndefined();
    expect(after.revision).toBe(2);
  });

  it.each([
    { name: "estimate に負数", args: { estimate: -1 }, message: "見積工数" },
    {
      name: "estimate に NaN",
      args: { estimate: Number.NaN },
      message: "見積工数",
    },
    {
      name: "estimate に Infinity",
      args: { estimate: Number.POSITIVE_INFINITY },
      message: "見積工数",
    },
    { name: "actual に負数", args: { actual: -1 }, message: "実績工数" },
    {
      name: "actual に NaN",
      args: { actual: Number.NaN },
      message: "実績工数",
    },
    {
      name: "actual に Infinity",
      args: { actual: Number.POSITIVE_INFINITY },
      message: "実績工数",
    },
  ])(
    "$name を指定すると ConvexError で拒否され DB は変わらない",
    async ({ args, message }) => {
      const t = setup();
      const project = await seedProject(t);
      const member = await seedMember(t);
      const { task } = await seedIssueWithTask(t, project, member);

      await expect(
        t.mutation(api.tasks.updateFields, {
          id: task,
          expectedRevision: 0,
          ...args,
        }),
      ).rejects.toThrowError(message);

      const after = await loadTask(t, task);
      expect(after.estimate).toBeUndefined();
      expect(after.actual).toBeUndefined();
      expect(after.revision).toBe(0);
    },
  );
});

// --- listByProject ------------------------------------------------------------

describe("tasks.listByProject", () => {
  it("指定プロジェクトの Task のみ返す（他プロジェクトの Task は含まない）", async () => {
    const t = setup();
    const member = await seedMember(t);
    const project = await seedProject(t, { key: "TASK" });
    const other = await seedProject(t, { key: "OTHER" });
    const { issue } = await seedIssueWithTask(t, project, member);
    await t.mutation(api.tasks.create, {
      issue,
      title: "2つ目",
      createdBy: member,
    });
    await seedIssueWithTask(t, other, member); // 他プロジェクト側にも Task を作る

    const listed = await t.query(api.tasks.listByProject, { project });

    expect(listed).toHaveLength(2);
    expect(listed.every((task) => task.project === project)).toBe(true);
    expect(listed.map((task) => task.number).toSorted()).toEqual([1, 2]);
  });

  it("Task のないプロジェクトは空配列を返す", async () => {
    const t = setup();
    const project = await seedProject(t);

    expect(await t.query(api.tasks.listByProject, { project })).toEqual([]);
  });
});

// --- listFiltered（MCP list_tasks 用のサーバー側絞り込み） --------------------

/**
 * listFiltered 用の配置。2プロジェクト・担当者ありなしで Task を配置する:
 * - TASK: 1(todo, Bob) / 2(backlog, Bob) / 3(backlog, 担当なし)
 * - OTHER: 1(backlog, Bob) …… project 絞り込みの検証用
 */
const arrangeFilteredTasks = async (t: T) => {
  const member = await seedMember(t);
  const bob = await seedMember(t, { name: "Bob", email: "bob@example.com" });
  const project = await seedProject(t, { key: "TASK" });
  const other = await seedProject(t, { key: "OTHER" });

  const { issue, task: first } = await t.mutation(api.issues.create, {
    project,
    title: "課題",
    createdBy: member,
    firstTask: { title: "1つ目", assignee: bob },
  });
  await t.mutation(api.tasks.transitionStatus, {
    id: first,
    to: "todo",
    expectedRevision: 0,
  });
  await t.mutation(api.tasks.create, {
    issue,
    title: "2つ目",
    assignee: bob,
    createdBy: member,
  });
  await t.mutation(api.tasks.create, {
    issue,
    title: "3つ目",
    createdBy: member,
  });
  await t.mutation(api.issues.create, {
    project: other,
    title: "他プロジェクトの課題",
    createdBy: member,
    firstTask: { title: "他プロジェクトのタスク", assignee: bob },
  });

  return { project, other, member, bob };
};

describe("tasks.listFiltered", () => {
  const arrange = arrangeFilteredTasks;

  it("絞り込みなしならプロジェクトの全 Task を返す（listByProject と同じ内容）", async () => {
    const t = setup();
    const { project } = await arrange(t);

    const listed = await t.query(api.tasks.listFiltered, { project });

    expect(listed.map((task) => task.number).toSorted()).toEqual([1, 2, 3]);
    expect(listed.every((task) => task.project === project)).toBe(true);
  });

  it("status 指定で該当ステータスの Task のみ返す", async () => {
    const t = setup();
    const { project } = await arrange(t);

    const listed = await t.query(api.tasks.listFiltered, {
      project,
      status: "backlog",
    });

    expect(listed.map((task) => task.number).toSorted()).toEqual([2, 3]);
    expect(listed.every((task) => task.status === "backlog")).toBe(true);
  });

  it("assignee 指定で担当 Task のみ返す（他プロジェクトの担当 Task は含まない）", async () => {
    const t = setup();
    const { project, bob } = await arrange(t);

    const listed = await t.query(api.tasks.listFiltered, {
      project,
      assignee: bob,
    });

    // OTHER 側にも Bob 担当の Task があるが、project で絞り込まれる
    expect(listed.map((task) => task.number).toSorted()).toEqual([1, 2]);
    expect(listed.every((task) => task.project === project)).toBe(true);
    expect(listed.every((task) => task.assignee === bob)).toBe(true);
  });

  it("status と assignee の同時指定は両条件を満たす Task のみ返す", async () => {
    const t = setup();
    const { project, bob } = await arrange(t);

    const listed = await t.query(api.tasks.listFiltered, {
      project,
      status: "todo",
      assignee: bob,
    });

    expect(listed.map((task) => task.number)).toEqual([1]);
  });

  it("該当がなければ空配列を返す", async () => {
    const t = setup();
    const { project } = await arrange(t);

    expect(
      await t.query(api.tasks.listFiltered, { project, status: "done" }),
    ).toEqual([]);
  });
});

// --- getByRef -------------------------------------------------------------

describe("tasks.getByRef", () => {
  it("{key}-{number} 参照から素の Task ドキュメントを解決する（表示用 join なし）", async () => {
    const t = setup();
    const member = await seedMember(t);
    const project = await seedProject(t, { key: "TASK" });
    const { issue } = await seedIssueWithTask(t, project, member);
    const second = await t.mutation(api.tasks.create, {
      issue,
      title: "2つ目",
      createdBy: member,
    });

    const found = await t.query(api.tasks.getByRef, {
      projectKey: "TASK",
      number: 2,
    });

    expect(found).toMatchObject({
      _id: second,
      project,
      number: 2,
      title: "2つ目",
    });
    // MCP が依存する安定契約: 表示用の join フィールドは付与しない
    expect(found).not.toHaveProperty("assigneeName");
    expect(found).not.toHaveProperty("issueNumber");
  });

  it.each([
    { name: "プロジェクトキーが未知", projectKey: "NONE", number: 1 },
    { name: "タスク番号が未知", projectKey: "TASK", number: 999 },
  ])("$name の場合は null を返す", async ({ projectKey, number }) => {
    const t = setup();
    const member = await seedMember(t);
    const project = await seedProject(t, { key: "TASK" });
    await seedIssueWithTask(t, project, member);

    expect(
      await t.query(api.tasks.getByRef, { projectKey, number }),
    ).toBeNull();
  });
});

// --- getDetail ------------------------------------------------------------

describe("tasks.getDetail", () => {
  // seedRepository が webhookSecret を暗号化するため環境変数で鍵を注入する
  beforeEach(() => {
    vi.stubEnv("WEBHOOK_ENCRYPTION_KEY", TEST_WEBHOOK_ENCRYPTION_KEY);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("親 Issue・表示名・GitLink（remoteUrl join）を付与して返す", async () => {
    const t = setup();
    const project = await seedProject(t, { key: "TASK" });
    const creator = await seedMember(t, { name: "Alice" });
    const assignee = await seedMember(t, {
      name: "Bob",
      email: "bob@example.com",
    });
    const { issue, task } = await t.mutation(api.issues.create, {
      project,
      title: "課題A",
      createdBy: creator,
      firstTask: { title: "タスクA", assignee },
    });
    const repository = await seedRepository(t, project);
    await seedGitLink(t, { task, repository });

    const detail = await t.query(api.tasks.getDetail, {
      projectKey: "TASK",
      number: 1,
    });

    expect(detail).toMatchObject({
      _id: task,
      issue,
      projectKey: "TASK",
      issueNumber: 1,
      issueTitle: "課題A",
      assigneeName: "Bob",
      createdByName: "Alice",
      gitLinks: [
        {
          type: "branch",
          externalRef: "feature/TASK-1",
          remoteUrl: TEST_REPO_REMOTE_URL, // repository を join した表示用 URL
        },
      ],
    });
  });

  it("担当者・GitLink がない Task は null / 空配列で返す", async () => {
    const t = setup();
    const member = await seedMember(t);
    const project = await seedProject(t, { key: "TASK" });
    await seedIssueWithTask(t, project, member);

    const detail = await t.query(api.tasks.getDetail, {
      projectKey: "TASK",
      number: 1,
    });

    expect(detail).toMatchObject({ assigneeName: null, gitLinks: [] });
  });

  it.each([
    { name: "プロジェクトキーが未知", projectKey: "NONE", number: 1 },
    { name: "タスク番号が未知", projectKey: "TASK", number: 999 },
  ])("$name の場合は null を返す", async ({ projectKey, number }) => {
    const t = setup();
    const member = await seedMember(t);
    const project = await seedProject(t, { key: "TASK" });
    await seedIssueWithTask(t, project, member);

    expect(
      await t.query(api.tasks.getDetail, { projectKey, number }),
    ).toBeNull();
  });
});

// --- board（整形出力） ------------------------------------------------------

describe("tasks.board（整形出力）", () => {
  it("固定6状態の列を順序どおり返し、各 Task に issueNumber と assigneeName を付与する", async () => {
    const t = setup();
    const project = await seedProject(t);
    const creator = await seedMember(t, { name: "Alice" });
    const assignee = await seedMember(t, {
      name: "Bob",
      email: "bob@example.com",
    });
    const { issue } = await t.mutation(api.issues.create, {
      project,
      title: "課題A",
      createdBy: creator,
      firstTask: { title: "担当あり", assignee },
    });
    await t.mutation(api.tasks.create, {
      issue,
      title: "担当なし",
      createdBy: creator,
    });

    const board = await t.query(api.tasks.board, { project });

    // 列は §5 の固定6状態・固定順
    expect(board.map((column) => column.status)).toEqual([
      "backlog",
      "todo",
      "in_progress",
      "in_review",
      "done",
      "canceled",
    ]);

    const backlog = board.find((column) => column.status === "backlog")!;
    expect(backlog.tasks).toMatchObject([
      { number: 1, issueNumber: 1, assigneeName: "Bob" },
      { number: 2, issueNumber: 1, assigneeName: null }, // 未割り当ては null
    ]);
    // PII: 表示名のみで member の email は載らない
    for (const task of backlog.tasks) {
      expect(task).not.toHaveProperty("email");
    }
  });

  it("担当者の実体が欠落していれば assigneeName は null になる", async () => {
    const t = setup();
    const project = await seedProject(t);
    const member = await seedMember(t);
    const ghost = await seedMember(t, {
      name: "Ghost",
      email: "ghost@example.com",
    });
    const { task } = await t.mutation(api.issues.create, {
      project,
      title: "課題",
      createdBy: member,
      firstTask: { title: "タスク", assignee: ghost },
    });
    await t.run((ctx) => ctx.db.delete(ghost)); // 参照だけ残して実体を消す

    const board = await t.query(api.tasks.board, { project });

    const backlog = board.find((column) => column.status === "backlog")!;
    expect(backlog.tasks).toMatchObject([{ _id: task, assigneeName: null }]);
  });
});
