// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  type As,
  TEST_REPO_REMOTE_URL,
  TEST_WEBHOOK_ENCRYPTION_KEY,
  authSubject,
  getTask,
  seedAuthedMember,
  seedGhostMember,
  seedGitLink,
  seedMember,
  seedProject,
  seedRepository,
  seedUser,
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
 *
 * 全公開関数は認証ゲート（Issue #1 PR2）配下のため、呼び出しは
 * seedAuthedMember が返す `as`（認証済み identity）で行う。createdBy 引数は
 * サーバ側で actor に強制されるため公開 API から消えている（詳細は
 * convex/lib/auth.test.ts）。
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
const seedIssueWithTask = (as: As, project: Id<"projects">) =>
  as.mutation(api.issues.create, {
    project,
    title: "課題",
    firstTask: { title: "最初のタスク" },
  });

/** issue 配下に startDate/dueDate 付きの Task を作り、id を返す（precondition 構築用）。 */
const seedDatedTask = (
  as: As,
  issue: Id<"issues">,
  dates: { startDate?: string; dueDate?: string },
) =>
  as.mutation(api.tasks.create, {
    issue,
    title: "期間つきタスク",
    ...dates,
  });

/** 指定列（status）の Task を rank 昇順（＝ボード表示順）に number で返す。 */
const columnNumbers = async (
  as: As,
  project: Id<"projects">,
  status: Doc<"tasks">["status"],
): Promise<number[]> => {
  const board = await as.query(api.tasks.board, { project });
  const column = board.find((c) => c.status === status);
  return (column?.tasks ?? []).map((task) => task.number);
};

// --- create -----------------------------------------------------------------

describe("tasks.create", () => {
  it("Issue 配下に backlog 列の Task を採番して作成し、採番カウンタを進め、createdBy を actor に強制する", async () => {
    const t = setup();
    const { as, memberId: member } = await seedAuthedMember(t);
    const project = await seedProject(t);
    // issues.create が number=1 の Task とカウンタ前進(→2)を消費している
    const { issue } = await seedIssueWithTask(as, project);

    const taskId = await as.mutation(api.tasks.create, {
      issue,
      title: "2つ目のタスク",
    });

    const task = await getTask(t, taskId);
    expect(task).toMatchObject({
      issue,
      project, // issue から解決した冗長参照が一致する（INVARIANT-5）
      number: 2, // 最初の Task が 1 を消費済み（INVARIANT-1）
      status: "backlog",
      priority: "none",
      revision: 0,
      createdBy: member, // 呼び出し元の actor が強制される（引数化はできない）
    });

    // 採番カウンタが次番号(3)まで進んでいる
    const proj = await t.run((ctx) => ctx.db.get(project));
    expect(proj?.nextTaskNumber).toBe(3);
  });

  it("存在しない Issue を指定すると拒否する（参照整合性）", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t);
    const { issue } = await seedIssueWithTask(as, project);
    await t.run((ctx) => ctx.db.delete(issue)); // 参照だけ残して実体を消す

    await expect(
      as.mutation(api.tasks.create, { issue, title: "x" }),
    ).rejects.toThrowError("Issue が存在しません");
  });

  describe("startDate / dueDate（ガント用の予定期間・Issue #141）", () => {
    it("startDate/dueDate を指定すると保存される", async () => {
      const t = setup();
      const { as } = await seedAuthedMember(t);
      const project = await seedProject(t);
      const { issue } = await seedIssueWithTask(as, project);

      const taskId = await as.mutation(api.tasks.create, {
        issue,
        title: "期間あり",
        startDate: "2026-08-01",
        dueDate: "2026-08-10",
      });

      expect(await loadTask(t, taskId)).toMatchObject({
        startDate: "2026-08-01",
        dueDate: "2026-08-10",
      });
    });

    it.each([
      { name: "startDate のみ", args: { startDate: "2026-08-01" } },
      { name: "dueDate のみ", args: { dueDate: "2026-08-10" } },
    ])("$name でも保存される", async ({ args }) => {
      const t = setup();
      const { as } = await seedAuthedMember(t);
      const project = await seedProject(t);
      const { issue } = await seedIssueWithTask(as, project);

      const taskId = await as.mutation(api.tasks.create, {
        issue,
        title: "片方だけ",
        ...args,
      });

      expect(await loadTask(t, taskId)).toMatchObject(args);
    });

    it("不正形式（ゼロ埋めなし）の日付は拒否する", async () => {
      const t = setup();
      const { as } = await seedAuthedMember(t);
      const project = await seedProject(t);
      const { issue } = await seedIssueWithTask(as, project);

      await expect(
        as.mutation(api.tasks.create, {
          issue,
          title: "不正形式",
          startDate: "2026-2-3",
        }),
      ).rejects.toThrowError("開始日");
    });

    it("非実在日（2月30日）は拒否する", async () => {
      const t = setup();
      const { as } = await seedAuthedMember(t);
      const project = await seedProject(t);
      const { issue } = await seedIssueWithTask(as, project);

      await expect(
        as.mutation(api.tasks.create, {
          issue,
          title: "非実在日",
          dueDate: "2026-02-30",
        }),
      ).rejects.toThrowError("期限日");
    });

    it("startDate が dueDate より後なら拒否する", async () => {
      const t = setup();
      const { as } = await seedAuthedMember(t);
      const project = await seedProject(t);
      const { issue } = await seedIssueWithTask(as, project);

      await expect(
        as.mutation(api.tasks.create, {
          issue,
          title: "順序逆転",
          startDate: "2026-08-10",
          dueDate: "2026-08-01",
        }),
      ).rejects.toThrowError("開始日は期限日以前の日付にしてください");
    });
  });
});

// --- transitionStatus -------------------------------------------------------

describe("tasks.transitionStatus", () => {
  it("状態機械が許す前進遷移を適用し revision を進める", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t);
    const { task } = await seedIssueWithTask(as, project);

    await as.mutation(api.tasks.transitionStatus, {
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
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t);
    const { task } = await seedIssueWithTask(as, project);

    await expect(
      as.mutation(api.tasks.transitionStatus, {
        id: task,
        to: "done",
        expectedRevision: 0,
      }),
    ).rejects.toThrowError("状態遷移できません");
  });

  it("in_review → in_progress の差し戻しを許可する", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t);
    const { task } = await seedIssueWithTask(as, project);

    // backlog → todo → in_progress → in_review まで前進させる
    let rev = 0;
    for (const to of ["todo", "in_progress", "in_review"] as const) {
      await as.mutation(api.tasks.transitionStatus, {
        id: task,
        to,
        expectedRevision: rev,
      });
      rev += 1;
    }

    await as.mutation(api.tasks.transitionStatus, {
      id: task,
      to: "in_progress",
      expectedRevision: rev,
    });

    expect((await loadTask(t, task)).status).toBe("in_progress");
  });

  it("古い revision での更新を競合として検出し拒否する（INVARIANT-2 楽観ロック）", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t);
    const { task } = await seedIssueWithTask(as, project);

    // 1回目で revision が 0→1 に進む
    await as.mutation(api.tasks.transitionStatus, {
      id: task,
      to: "todo",
      expectedRevision: 0,
    });

    // 同じ revision=0 で再度更新しようとすると競合
    await expect(
      as.mutation(api.tasks.transitionStatus, {
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
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t);
    const { issue, task: a } = await seedIssueWithTask(as, project);
    const b = await as.mutation(api.tasks.create, {
      issue,
      title: "B",
    });
    const c = await as.mutation(api.tasks.create, {
      issue,
      title: "C",
    });
    return { as, project, a, b, c };
  };

  it("move は before/after の間へ rank を割り当て、列の並びを入れ替える", async () => {
    const t = setup();
    const { as, project, a, b, c } = await seedThreeBacklogTasks(t);

    // 初期の backlog 並びは作成順 [1(a), 2(b), 3(c)]
    expect(await columnNumbers(as, project, "backlog")).toEqual([1, 2, 3]);

    const aRank = (await loadTask(t, a)).rank;
    const bRank = (await loadTask(t, b)).rank;

    // c を a と b の間へ移動（before=a, after=b）
    await as.mutation(api.tasks.move, {
      id: c,
      before: aRank,
      after: bRank,
      expectedRevision: 0,
    });

    // 並びは [a, c, b] = [1, 3, 2] になり、c の rank は厳密に a と b の間
    expect(await columnNumbers(as, project, "backlog")).toEqual([1, 3, 2]);
    const moved = await loadTask(t, c);
    expect(aRank < moved.rank && moved.rank < bRank).toBe(true);
    expect(moved.revision).toBe(1);
  });

  it("move は先頭（before=null）へ移動でき、列の先頭に来る", async () => {
    const t = setup();
    const { as, project, a, c } = await seedThreeBacklogTasks(t);

    // c を先頭へ移動。先頭に来るには「現在の先頭（a）の前」= after に a の rank を渡す。
    // before=null は先頭より前（左端）を意味し、rankBetween(null, aRank) で a より前の rank になる。
    const aRank = (await loadTask(t, a)).rank;
    await as.mutation(api.tasks.move, {
      id: c,
      before: null,
      after: aRank,
      expectedRevision: 0,
    });

    // 並びは [c, a, b] = [3, 1, 2] になり、c が列の先頭に来る。
    // order[0] のみだと a/b の相対順序の破壊を見逃すため、全順序で検証する。
    const order = await columnNumbers(as, project, "backlog");
    expect(order).toEqual([3, 1, 2]);
  });

  it("transitionStatus は列をまたいで before/after の間へ挿入する（D&D ドロップ位置・#8）", async () => {
    const t = setup();
    const { as, project, a, b, c } = await seedThreeBacklogTasks(t);

    // a, b を todo 列へ末尾追加 → todo は [a, b]
    await as.mutation(api.tasks.transitionStatus, {
      id: a,
      to: "todo",
      expectedRevision: 0,
    });
    await as.mutation(api.tasks.transitionStatus, {
      id: b,
      to: "todo",
      expectedRevision: 0,
    });
    expect(await columnNumbers(as, project, "todo")).toEqual([1, 2]);

    const aRank = (await loadTask(t, a)).rank;
    const bRank = (await loadTask(t, b)).rank;

    // c を backlog から todo の a・b の間へドロップ
    await as.mutation(api.tasks.transitionStatus, {
      id: c,
      to: "todo",
      expectedRevision: 0,
      before: aRank,
      after: bRank,
    });

    // todo は [a, c, b] = [1, 3, 2]、c は todo へ移り backlog から消える
    expect(await columnNumbers(as, project, "todo")).toEqual([1, 3, 2]);
    expect(await columnNumbers(as, project, "backlog")).toEqual([]);
    expect((await loadTask(t, c)).status).toBe("todo");
  });

  it("位置指定なしの transitionStatus は遷移先列の末尾に置く", async () => {
    const t = setup();
    const { as, project, a, b } = await seedThreeBacklogTasks(t);

    // a を todo へ（末尾）→ 続いて b を todo へ（末尾）→ [a, b]
    await as.mutation(api.tasks.transitionStatus, {
      id: a,
      to: "todo",
      expectedRevision: 0,
    });
    await as.mutation(api.tasks.transitionStatus, {
      id: b,
      to: "todo",
      expectedRevision: 0,
    });

    expect(await columnNumbers(as, project, "todo")).toEqual([1, 2]);
  });
});

// --- assign -----------------------------------------------------------------

describe("tasks.assign", () => {
  it("担当者を割り当て、null で解除できる", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t);
    const assignee = await seedMember(t, {
      name: "Bob",
      email: "bob@example.com",
    });
    const { task } = await seedIssueWithTask(as, project);

    await as.mutation(api.tasks.assign, {
      id: task,
      assignee,
      expectedRevision: 0,
    });
    expect((await loadTask(t, task)).assignee).toBe(assignee);

    await as.mutation(api.tasks.assign, {
      id: task,
      assignee: null,
      expectedRevision: 1,
    });
    expect((await loadTask(t, task)).assignee).toBeUndefined();
  });

  it("存在しないメンバーの割り当てを拒否する", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t);
    const ghost = await seedGhostMember(t);
    const { task } = await seedIssueWithTask(as, project);

    await expect(
      as.mutation(api.tasks.assign, {
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
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t);
    const { task } = await seedIssueWithTask(as, project);

    await expect(
      as.mutation(api.tasks.deleteTask, { id: task, expectedRevision: 0 }),
    ).rejects.toThrowError("最後の Task は削除できません");

    // 実際に残っていることを確認
    expect(await getTask(t, task)).not.toBeNull();
  });

  it("兄弟 Task があれば削除し、関連 GitLink も併せて削除する（参照整合性）", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t);
    const { issue, task: first } = await seedIssueWithTask(as, project);
    const second = await as.mutation(api.tasks.create, {
      issue,
      title: "2つ目",
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

    await as.mutation(api.tasks.deleteTask, {
      id: first,
      expectedRevision: 0,
    });

    expect(await getTask(t, first)).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(link))).toBeNull(); // GitLink も消える
    expect(await getTask(t, second)).not.toBeNull(); // 兄弟は残る
  });

  it("古い revision での削除を競合として拒否する（楽観ロック）", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t);
    const { issue, task: first } = await seedIssueWithTask(as, project);
    await as.mutation(api.tasks.create, {
      issue,
      title: "2つ目",
    });

    // revision を進めておく
    await as.mutation(api.tasks.transitionStatus, {
      id: first,
      to: "todo",
      expectedRevision: 0,
    });

    await expect(
      as.mutation(api.tasks.deleteTask, { id: first, expectedRevision: 0 }),
    ).rejects.toThrowError("競合");
  });
});

// --- updateFields -------------------------------------------------------------

describe("tasks.updateFields", () => {
  it("指定したフィールドのみ更新し、revision を進める", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t);
    const { issue, task } = await as.mutation(api.issues.create, {
      project,
      title: "課題",
      firstTask: {
        title: "元のタイトル",
        description: "元の説明",
        priority: "low",
      },
    });

    await as.mutation(api.tasks.updateFields, {
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
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t);
    const { task } = await seedIssueWithTask(as, project);

    // revision を 0→1 に進めておく
    await as.mutation(api.tasks.updateFields, {
      id: task,
      expectedRevision: 0,
      title: "1回目の更新",
    });

    await expect(
      as.mutation(api.tasks.updateFields, {
        id: task,
        expectedRevision: 0, // 古い revision
        title: "競合する更新",
      }),
    ).rejects.toThrowError("競合");

    expect((await loadTask(t, task)).title).toBe("1回目の更新");
  });

  it("存在しないタスクを拒否する", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t);
    const { issue, task } = await seedIssueWithTask(as, project);
    await as.mutation(api.issues.remove, { id: issue, expectedRevision: 0 });

    await expect(
      as.mutation(api.tasks.updateFields, {
        id: task,
        expectedRevision: 0,
        title: "x",
      }),
    ).rejects.toThrowError("タスクが見つかりません");
  });

  it("estimate / actual を設定でき、getDetail / board の返却に反映される", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t, { key: "TASK" });
    const { task } = await seedIssueWithTask(as, project);

    await as.mutation(api.tasks.updateFields, {
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

    const detail = await as.query(api.tasks.getDetail, {
      projectKey: "TASK",
      number: 1,
    });
    expect(detail).toMatchObject({ estimate: 8, actual: 3.5 });

    const board = await as.query(api.tasks.board, { project });
    const backlog = board.find((column) => column.status === "backlog")!;
    expect(backlog.tasks).toMatchObject([{ estimate: 8, actual: 3.5 }]);
  });

  it("estimate / actual に null を指定するとクリアされる（DB 上 undefined）", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t);
    const { task } = await seedIssueWithTask(as, project);

    await as.mutation(api.tasks.updateFields, {
      id: task,
      expectedRevision: 0,
      estimate: 8,
      actual: 3,
    });
    await as.mutation(api.tasks.updateFields, {
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
      const { as } = await seedAuthedMember(t);
      const project = await seedProject(t);
      const { task } = await seedIssueWithTask(as, project);

      await expect(
        as.mutation(api.tasks.updateFields, {
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

  describe("startDate / dueDate（ガント用の予定期間・Issue #141）", () => {
    it("両方指定すると保存される", async () => {
      const t = setup();
      const { as } = await seedAuthedMember(t);
      const project = await seedProject(t);
      const { task } = await seedIssueWithTask(as, project);

      await as.mutation(api.tasks.updateFields, {
        id: task,
        expectedRevision: 0,
        startDate: "2026-08-01",
        dueDate: "2026-08-10",
      });

      expect(await loadTask(t, task)).toMatchObject({
        startDate: "2026-08-01",
        dueDate: "2026-08-10",
        revision: 1,
      });
    });

    it("null を指定するとクリアされる（DB 上 undefined）", async () => {
      const t = setup();
      const { as } = await seedAuthedMember(t);
      const project = await seedProject(t);
      const { issue } = await seedIssueWithTask(as, project);
      const task = await seedDatedTask(as, issue, {
        startDate: "2026-08-01",
        dueDate: "2026-08-10",
      });

      await as.mutation(api.tasks.updateFields, {
        id: task,
        expectedRevision: 0,
        startDate: null,
        dueDate: null,
      });

      const after = await loadTask(t, task);
      expect(after.startDate).toBeUndefined();
      expect(after.dueDate).toBeUndefined();
      expect(after.revision).toBe(1);
    });

    it("dueDate のみ更新し、既存の startDate と逆転するなら ConvexError で拒否し DB を変えない", async () => {
      const t = setup();
      const { as } = await seedAuthedMember(t);
      const project = await seedProject(t);
      const { issue } = await seedIssueWithTask(as, project);
      const task = await seedDatedTask(as, issue, { startDate: "2026-08-10" });

      await expect(
        as.mutation(api.tasks.updateFields, {
          id: task,
          expectedRevision: 0,
          dueDate: "2026-08-01", // 既存 startDate（08-10）より前
        }),
      ).rejects.toThrowError("開始日は期限日以前の日付にしてください");

      const after = await loadTask(t, task);
      expect(after.startDate).toBe("2026-08-10");
      expect(after.dueDate).toBeUndefined();
      expect(after.revision).toBe(0); // 拒否時は revision が進まない
    });

    it("startDate のみ更新し、既存の dueDate と整合するなら成功する", async () => {
      const t = setup();
      const { as } = await seedAuthedMember(t);
      const project = await seedProject(t);
      const { issue } = await seedIssueWithTask(as, project);
      const task = await seedDatedTask(as, issue, { dueDate: "2026-08-10" });

      await as.mutation(api.tasks.updateFields, {
        id: task,
        expectedRevision: 0,
        startDate: "2026-08-01", // 既存 dueDate（08-10）以前
      });

      expect(await loadTask(t, task)).toMatchObject({
        startDate: "2026-08-01",
        dueDate: "2026-08-10",
        revision: 1,
      });
    });

    // マージ検証: 事前状態（両方あり/片方のみ/なし）× 引数（未指定/null/日付）の
    // 代表的な組み合わせで、更新後も「両方定義済みなら startDate ≤ dueDate」が
    // 常に成立することを検証する（片側更新でも既存値とマージした組で判定される）。
    it.each([
      {
        name: "両方ありで startDate を null クリアと同時に dueDate を新しい日付へ更新",
        precondition: { startDate: "2026-08-01", dueDate: "2026-08-10" },
        args: { startDate: null, dueDate: "2026-08-20" },
        expected: { startDate: undefined, dueDate: "2026-08-20" },
      },
      {
        name: "両方ありで両方を null クリア",
        precondition: { startDate: "2026-08-01", dueDate: "2026-08-10" },
        args: { startDate: null, dueDate: null },
        expected: { startDate: undefined, dueDate: undefined },
      },
      {
        name: "startDate のみありで startDate を null クリアと同時に dueDate を設定",
        precondition: { startDate: "2026-08-01" },
        args: { startDate: null, dueDate: "2026-08-15" },
        expected: { startDate: undefined, dueDate: "2026-08-15" },
      },
      {
        name: "なしで dueDate のみ設定",
        precondition: {},
        args: { dueDate: "2026-08-15" },
        expected: { startDate: undefined, dueDate: "2026-08-15" },
      },
    ])(
      "$name → 成功し、更新後も startDate ≤ dueDate（未定義含む）が保たれる",
      async ({ precondition, args, expected }) => {
        const t = setup();
        const { as } = await seedAuthedMember(t);
        const project = await seedProject(t);
        const { issue } = await seedIssueWithTask(as, project);
        const task = await seedDatedTask(as, issue, precondition);

        await as.mutation(api.tasks.updateFields, {
          id: task,
          expectedRevision: 0,
          ...args,
        });

        const after = await loadTask(t, task);
        expect(after.startDate).toBe(expected.startDate);
        expect(after.dueDate).toBe(expected.dueDate);
        expect(after.revision).toBe(1);
      },
    );

    it.each([
      {
        name: "両方ありで既存 dueDate より後の startDate を設定",
        precondition: { startDate: "2026-08-01", dueDate: "2026-08-10" },
        args: { startDate: "2026-08-20" },
      },
      {
        name: "dueDate のみありで既存 dueDate より後の startDate を設定",
        precondition: { dueDate: "2026-08-10" },
        args: { startDate: "2026-08-20" },
      },
    ])(
      "$name → ConvexError で拒否され、DB・revision は変わらない",
      async ({ precondition, args }) => {
        const t = setup();
        const { as } = await seedAuthedMember(t);
        const project = await seedProject(t);
        const { issue } = await seedIssueWithTask(as, project);
        const task = await seedDatedTask(as, issue, precondition);
        const before = await loadTask(t, task);

        await expect(
          as.mutation(api.tasks.updateFields, {
            id: task,
            expectedRevision: 0,
            ...args,
          }),
        ).rejects.toThrowError("開始日は期限日以前の日付にしてください");

        const after = await loadTask(t, task);
        expect(after.startDate).toBe(before.startDate);
        expect(after.dueDate).toBe(before.dueDate);
        expect(after.revision).toBe(before.revision);
        expect(after.updatedAt).toBe(before.updatedAt);
      },
    );
  });
});

// --- listByProject ------------------------------------------------------------

describe("tasks.listByProject", () => {
  it("指定プロジェクトの Task のみ返す（他プロジェクトの Task は含まない）", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t, { key: "TASK" });
    const other = await seedProject(t, { key: "OTHER" });
    const { issue } = await seedIssueWithTask(as, project);
    await as.mutation(api.tasks.create, {
      issue,
      title: "2つ目",
    });
    await seedIssueWithTask(as, other); // 他プロジェクト側にも Task を作る

    const listed = await as.query(api.tasks.listByProject, { project });

    expect(listed).toHaveLength(2);
    expect(listed.every((task) => task.project === project)).toBe(true);
    expect(listed.map((task) => task.number).toSorted()).toEqual([1, 2]);
  });

  it("Task のないプロジェクトは空配列を返す", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t);

    expect(await as.query(api.tasks.listByProject, { project })).toEqual([]);
  });
});

// --- listFiltered（MCP list_tasks 用のサーバー側絞り込み） --------------------

/**
 * listFiltered 用の配置。2プロジェクト・担当者ありなし・優先度違いで Task を配置する:
 * - TASK: 1(todo, Bob, urgent) / 2(backlog, Bob, low) / 3(backlog, 担当なし, urgent)
 * - OTHER: 1(backlog, Bob, none) …… project 絞り込みの検証用
 */
const arrangeFilteredTasks = async (t: T) => {
  const { as } = await seedAuthedMember(t);
  const bob = await seedMember(t, { name: "Bob", email: "bob@example.com" });
  const project = await seedProject(t, { key: "TASK" });
  const other = await seedProject(t, { key: "OTHER" });

  const { issue, task: first } = await as.mutation(api.issues.create, {
    project,
    title: "課題",
    firstTask: { title: "1つ目", assignee: bob, priority: "urgent" },
  });
  await as.mutation(api.tasks.transitionStatus, {
    id: first,
    to: "todo",
    expectedRevision: 0,
  });
  await as.mutation(api.tasks.create, {
    issue,
    title: "2つ目",
    assignee: bob,
    priority: "low",
  });
  await as.mutation(api.tasks.create, {
    issue,
    title: "3つ目",
    priority: "urgent",
  });
  await as.mutation(api.issues.create, {
    project: other,
    title: "他プロジェクトの課題",
    firstTask: { title: "他プロジェクトのタスク", assignee: bob },
  });

  return { as, project, other, bob };
};

describe("tasks.listFiltered", () => {
  const arrange = arrangeFilteredTasks;

  it("絞り込みなしならプロジェクトの全 Task を返す（listByProject と同じ内容）", async () => {
    const t = setup();
    const { as, project } = await arrange(t);

    const listed = await as.query(api.tasks.listFiltered, { project });

    expect(listed.map((task) => task.number).toSorted()).toEqual([1, 2, 3]);
    expect(listed.every((task) => task.project === project)).toBe(true);
  });

  it("status 指定で該当ステータスの Task のみ返す", async () => {
    const t = setup();
    const { as, project } = await arrange(t);

    const listed = await as.query(api.tasks.listFiltered, {
      project,
      status: "backlog",
    });

    expect(listed.map((task) => task.number).toSorted()).toEqual([2, 3]);
    expect(listed.every((task) => task.status === "backlog")).toBe(true);
  });

  it("assignee 指定で担当 Task のみ返す（他プロジェクトの担当 Task は含まない）", async () => {
    const t = setup();
    const { as, project, bob } = await arrange(t);

    const listed = await as.query(api.tasks.listFiltered, {
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
    const { as, project, bob } = await arrange(t);

    const listed = await as.query(api.tasks.listFiltered, {
      project,
      status: "todo",
      assignee: bob,
    });

    expect(listed.map((task) => task.number)).toEqual([1]);
  });

  it("該当がなければ空配列を返す", async () => {
    const t = setup();
    const { as, project } = await arrange(t);

    expect(
      await as.query(api.tasks.listFiltered, { project, status: "done" }),
    ).toEqual([]);
  });

  it("priority 指定で該当優先度の Task のみ返す", async () => {
    const t = setup();
    const { as, project } = await arrange(t);

    const listed = await as.query(api.tasks.listFiltered, {
      project,
      priority: "urgent",
    });

    expect(listed.map((task) => task.number).toSorted()).toEqual([1, 3]);
    expect(listed.every((task) => task.priority === "urgent")).toBe(true);
  });

  it("priority と status の同時指定は両条件を満たす Task のみ返す", async () => {
    const t = setup();
    const { as, project } = await arrange(t);

    const listed = await as.query(api.tasks.listFiltered, {
      project,
      status: "backlog",
      priority: "urgent",
    });

    expect(listed.map((task) => task.number)).toEqual([3]);
  });

  it("priority と assignee の同時指定は両条件を満たす Task のみ返す", async () => {
    const t = setup();
    const { as, project, bob } = await arrange(t);

    const listed = await as.query(api.tasks.listFiltered, {
      project,
      assignee: bob,
      priority: "urgent",
    });

    expect(listed.map((task) => task.number)).toEqual([1]);
  });

  it("priority に該当する Task がなければ空配列を返す", async () => {
    const t = setup();
    const { as, project } = await arrange(t);

    expect(
      await as.query(api.tasks.listFiltered, { project, priority: "high" }),
    ).toEqual([]);
  });
});

// --- getByRef -------------------------------------------------------------

describe("tasks.getByRef", () => {
  it("{key}-{number} 参照から素の Task ドキュメントを解決する（表示用 join なし）", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t, { key: "TASK" });
    const { issue } = await seedIssueWithTask(as, project);
    const second = await as.mutation(api.tasks.create, {
      issue,
      title: "2つ目",
    });

    const found = await as.query(api.tasks.getByRef, {
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
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t, { key: "TASK" });
    await seedIssueWithTask(as, project);

    expect(
      await as.query(api.tasks.getByRef, { projectKey, number }),
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
    const { as } = await seedAuthedMember(t, { name: "Alice" });
    const project = await seedProject(t, { key: "TASK" });
    const assignee = await seedMember(t, {
      name: "Bob",
      email: "bob@example.com",
    });
    const { issue, task } = await as.mutation(api.issues.create, {
      project,
      title: "課題A",
      firstTask: { title: "タスクA", assignee },
    });
    const repository = await seedRepository(t, project);
    await seedGitLink(t, { task, repository });

    const detail = await as.query(api.tasks.getDetail, {
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
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t, { key: "TASK" });
    await seedIssueWithTask(as, project);

    const detail = await as.query(api.tasks.getDetail, {
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
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t, { key: "TASK" });
    await seedIssueWithTask(as, project);

    expect(
      await as.query(api.tasks.getDetail, { projectKey, number }),
    ).toBeNull();
  });
});

// --- board（整形出力） ------------------------------------------------------

describe("tasks.board（整形出力）", () => {
  it("固定6状態の列を順序どおり返し、各 Task に issueNumber と assigneeName を付与する", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t, { name: "Alice" });
    const project = await seedProject(t);
    const assignee = await seedMember(t, {
      name: "Bob",
      email: "bob@example.com",
    });
    const { issue } = await as.mutation(api.issues.create, {
      project,
      title: "課題A",
      firstTask: { title: "担当あり", assignee },
    });
    await as.mutation(api.tasks.create, {
      issue,
      title: "担当なし",
    });

    const board = await as.query(api.tasks.board, { project });

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
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t);
    const ghost = await seedMember(t, {
      name: "Ghost",
      email: "ghost@example.com",
    });
    const { task } = await as.mutation(api.issues.create, {
      project,
      title: "課題",
      firstTask: { title: "タスク", assignee: ghost },
    });
    await t.run((ctx) => ctx.db.delete(ghost)); // 参照だけ残して実体を消す

    const board = await as.query(api.tasks.board, { project });

    const backlog = board.find((column) => column.status === "backlog")!;
    expect(backlog.tasks).toMatchObject([{ _id: task, assigneeName: null }]);
  });
});

// --- gantt（ガントチャート表示用・Issue #141） -------------------------------

/**
 * gantt query の表示対象フィルタを検証する結合テスト。
 * issues.create の firstTask は startDate/dueDate を持てないため、
 * 「日付なし Task」の自然なフィクスチャとして流用する。
 */
describe("tasks.gantt", () => {
  const arrangeGanttFixture = async (t: T) => {
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t);
    const { issue, task: undated } = await seedIssueWithTask(as, project);
    const withDates = await seedDatedTask(as, issue, {
      startDate: "2026-08-01",
      dueDate: "2026-08-10",
    });
    const startOnly = await seedDatedTask(as, issue, {
      startDate: "2026-08-15",
    });
    const canceled = await seedDatedTask(as, issue, { dueDate: "2026-08-20" });
    await as.mutation(api.tasks.transitionStatus, {
      id: canceled,
      to: "canceled",
      expectedRevision: 0,
    });
    return { as, project, issue, undated, withDates, startOnly, canceled };
  };

  it("canceled の Task は返らない", async () => {
    const t = setup();
    const { as, project, canceled } = await arrangeGanttFixture(t);

    const result = await as.query(api.tasks.gantt, { project });

    const taskIds = result.flatMap((i) => i.tasks.map((task) => task._id));
    expect(taskIds).not.toContain(canceled);
  });

  it("startDate/dueDate ともに未設定の Task は返らない", async () => {
    const t = setup();
    const { as, project, undated } = await arrangeGanttFixture(t);

    const result = await as.query(api.tasks.gantt, { project });

    const taskIds = result.flatMap((i) => i.tasks.map((task) => task._id));
    expect(taskIds).not.toContain(undated);
  });

  it("片方のみ日付ありの Task は返り、未設定の側は null に正規化される", async () => {
    const t = setup();
    const { as, project, startOnly } = await arrangeGanttFixture(t);

    const result = await as.query(api.tasks.gantt, { project });

    const found = result
      .flatMap((i) => i.tasks)
      .find((task) => task._id === startOnly);
    expect(found).toMatchObject({
      startDate: "2026-08-15",
      dueDate: null,
    });
  });

  it("表示対象 Task を1つも持たない Issue は結果に含まれない", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t);
    // firstTask は日付なしのため、この Issue には表示対象 Task が無い
    const { issue } = await seedIssueWithTask(as, project);

    const result = await as.query(api.tasks.gantt, { project });

    expect(result.map((i) => i._id)).not.toContain(issue);
  });

  it("表示対象 Task を持つ Issue は number/title と該当 Task のみを返す", async () => {
    const t = setup();
    const { as, project, issue, withDates } = await arrangeGanttFixture(t);

    const result = await as.query(api.tasks.gantt, { project });

    expect(result).toMatchObject([
      {
        _id: issue,
        number: 1,
        title: "課題",
        tasks: [
          { _id: withDates, startDate: "2026-08-01", dueDate: "2026-08-10" },
          { startDate: "2026-08-15", dueDate: null },
        ],
      },
    ]);
  });

  describe("gantt の認証ゲート（Issue #1 PR2）", () => {
    it("未認証の呼び出しは ConvexError で拒否する", async () => {
      const t = setup();
      const project = await seedProject(t);

      await expect(t.query(api.tasks.gantt, { project })).rejects.toThrowError(
        "認証が必要です",
      );
    });
  });
});

// --- listMine（「My Tasks」ビュー用・全プロジェクト横断） -----------------------

describe("tasks.listMine", () => {
  it("全プロジェクト横断で自分の担当 Task だけを返し、projectKey と issueNumber を付与する", async () => {
    const t = setup();
    const { as, memberId: me } = await seedAuthedMember(t);
    const projectA = await seedProject(t, { key: "TASK" });
    const projectB = await seedProject(t, { key: "WEB" });

    const { issue: issueA, task: taskA } = await as.mutation(
      api.issues.create,
      {
        project: projectA,
        title: "課題A",
        firstTask: { title: "自分の担当A", assignee: me },
      },
    );
    const { task: taskB } = await as.mutation(api.issues.create, {
      project: projectB,
      title: "課題B",
      firstTask: { title: "自分の担当B", assignee: me },
    });

    const listed = await as.query(api.tasks.listMine, {});

    expect(listed.map((task) => task._id).toSorted()).toEqual(
      [taskA, taskB].toSorted(),
    );
    const found = listed.find((task) => task._id === taskA)!;
    expect(found).toMatchObject({
      projectKey: "TASK",
      issueNumber: 1,
      issue: issueA,
    });
  });

  it("参照先 Project が欠落した Task はログを残して一覧から除外する（サイレント失敗の回避）", async () => {
    const t = setup();
    const { as, memberId: me } = await seedAuthedMember(t);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const staleProject = await seedProject(t, { key: "STALE" });
    const healthyProject = await seedProject(t, { key: "TASK" });

    const { task: orphanTask } = await as.mutation(api.issues.create, {
      project: staleProject,
      title: "課題（Project 欠落）",
      firstTask: { title: "参照先が消えるタスク", assignee: me },
    });
    const { task: healthyTask } = await as.mutation(api.issues.create, {
      project: healthyProject,
      title: "課題（健全）",
      firstTask: { title: "健全なタスク", assignee: me },
    });
    // Project 側だけが欠落した状態を作る（実運用では通常発生しないが、
    // 参照整合性が崩れても一覧生成が壊れないことを保証する防御的分岐の検証）。
    await t.run((ctx) => ctx.db.delete(staleProject));

    const listed = await as.query(api.tasks.listMine, {});

    expect(listed.map((task) => task._id)).toEqual([healthyTask]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(orphanTask));
    warnSpy.mockRestore();
  });

  it("他人の担当・未割り当ての Task は含まない", async () => {
    const t = setup();
    const { as, memberId: me } = await seedAuthedMember(t);
    const other = await seedMember(t, {
      name: "Bob",
      email: "bob@example.com",
    });
    const project = await seedProject(t);

    await as.mutation(api.issues.create, {
      project,
      title: "課題",
      firstTask: { title: "他人の担当", assignee: other },
    });
    const { issue } = await as.mutation(api.issues.create, {
      project,
      title: "課題2",
      firstTask: { title: "未割り当て" },
    });
    const mine = await as.mutation(api.tasks.create, {
      issue,
      title: "自分の担当",
      assignee: me,
    });

    const listed = await as.query(api.tasks.listMine, {});

    expect(listed.map((task) => task._id)).toEqual([mine]);
  });

  it("認証済みだが Member 未リンクのユーザーには空配列を返す", async () => {
    const t = setup();
    await seedMember(t);
    const userId = await seedUser(t, { email: "nobody@example.com" });
    const asUnlinked = t.withIdentity({ subject: authSubject(userId) });

    expect(await asUnlinked.query(api.tasks.listMine, {})).toEqual([]);
  });

  it("未認証の呼び出しは ConvexError で拒否する", async () => {
    const t = setup();

    await expect(t.query(api.tasks.listMine, {})).rejects.toThrowError(
      "認証が必要です",
    );
  });
});
