// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  getTask,
  seedMember,
  seedProject,
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

const modules = import.meta.glob("./**/*.ts");
const setup = () => convexTest(schema, modules);

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
    const ghost = await seedMember(t, { email: "ghost@example.com" });
    await t.run((ctx) => ctx.db.delete(ghost));

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

    const after = await getTask(t, task);
    expect(after?.status).toBe("todo");
    expect(after?.revision).toBe(1);
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

    expect((await getTask(t, task))?.status).toBe("in_progress");
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

    const aRank = (await getTask(t, a))!.rank;
    const bRank = (await getTask(t, b))!.rank;

    // c を a と b の間へ移動（before=a, after=b）
    await t.mutation(api.tasks.move, {
      id: c,
      before: aRank,
      after: bRank,
      expectedRevision: 0,
    });

    // 並びは [a, c, b] = [1, 3, 2] になり、c の rank は厳密に a と b の間
    expect(await columnNumbers(t, project, "backlog")).toEqual([1, 3, 2]);
    const moved = (await getTask(t, c))!;
    expect(aRank < moved.rank && moved.rank < bRank).toBe(true);
    expect(moved.revision).toBe(1);
  });

  it("move は先頭（before=null）へ移動でき、列の先頭に来る", async () => {
    const t = setup();
    const { project, a, c } = await seedThreeBacklogTasks(t);

    // c を先頭へ移動。先頭に来るには「現在の先頭（a）の前」= after に a の rank を渡す。
    // before=null は先頭より前（左端）を意味し、rankBetween(null, aRank) で a より前の rank になる。
    const aRank = (await getTask(t, a))!.rank;
    await t.mutation(api.tasks.move, {
      id: c,
      before: null,
      after: aRank,
      expectedRevision: 0,
    });

    // 並びは [c, a, b] = [3, 1, 2] になり、c が列の先頭に来る。
    const order = await columnNumbers(t, project, "backlog");
    expect(order[0]).toBe(3); // c(3) が先頭
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

    const aRank = (await getTask(t, a))!.rank;
    const bRank = (await getTask(t, b))!.rank;

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
    expect((await getTask(t, c))!.status).toBe("todo");
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
    expect((await getTask(t, task))?.assignee).toBe(assignee);

    await t.mutation(api.tasks.assign, {
      id: task,
      assignee: null,
      expectedRevision: 1,
    });
    expect((await getTask(t, task))?.assignee).toBeUndefined();
  });

  it("存在しないメンバーの割り当てを拒否する", async () => {
    const t = setup();
    const project = await seedProject(t);
    const member = await seedMember(t);
    const ghost = await seedMember(t, { email: "ghost@example.com" });
    await t.run((ctx) => ctx.db.delete(ghost));
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
