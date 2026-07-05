// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { seedMember, seedProject, type T } from "../test/convexSupport";

/**
 * Issue Core ミューテーション／クエリの結合テスト（基本設計書 §3/§5.1/ADR-9/ADR-10）。
 *
 * 検証の中心は Issue 固有の2つの不変条件:
 * - INVARIANT-5: Issue は常に ≥1 Task を持つ（作成は最初の Task を伴う／削除はカスケード）
 * - §5.1: Issue.status は保持せず子 Task 群から一意に派生する
 * deriveIssueStatus 自体は lib/issueStatus.test.ts で単体検証済み。ここでは
 * ミューテーション経由で Task を遷移させたとき、クエリが正しい派生状態を返すかを見る。
 */

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const setup = () => convexTest(schema, modules);

/** active な Task の線形な前進経路（backlog はこの手前の初期状態）。 */
const FORWARD_PATH = ["todo", "in_progress", "in_review", "done"] as const;

/** Task を状態機械に沿って target まで前進させる（revision を追跡）。 */
const driveTo = async (
  t: T,
  taskId: Id<"tasks">,
  target: (typeof FORWARD_PATH)[number],
) => {
  let rev = 0;
  for (const to of FORWARD_PATH) {
    await t.mutation(api.tasks.transitionStatus, {
      id: taskId,
      to,
      expectedRevision: rev,
    });
    rev += 1;
    if (to === target) return;
  }
};

// --- create -----------------------------------------------------------------

describe("issues.create", () => {
  it("Issue と最初の Task を同時に採番して作成する（INVARIANT-5）", async () => {
    const t = setup();
    const project = await seedProject(t);
    const member = await seedMember(t);

    const { issue, task } = await t.mutation(api.issues.create, {
      project,
      title: "課題A",
      createdBy: member,
      firstTask: { title: "タスクA", priority: "high" },
    });

    const issueDoc = await t.run((ctx) => ctx.db.get(issue));
    const taskDoc = await t.run((ctx) => ctx.db.get(task));

    expect(issueDoc).toMatchObject({ project, number: 1, title: "課題A" });
    // Task は Issue に従属し、project は Issue から解決される
    expect(taskDoc).toMatchObject({
      issue,
      project,
      number: 1,
      status: "backlog",
      priority: "high",
    });

    // 採番カウンタは Issue／Task で独立に前進する（INVARIANT-1）
    const proj = await t.run((ctx) => ctx.db.get(project));
    expect(proj).toMatchObject({ nextIssueNumber: 2, nextTaskNumber: 2 });
  });

  it("存在しないプロジェクトを指定すると拒否する", async () => {
    const t = setup();
    const project = await seedProject(t);
    const member = await seedMember(t);
    await t.run((ctx) => ctx.db.delete(project));

    await expect(
      t.mutation(api.issues.create, {
        project,
        title: "x",
        createdBy: member,
        firstTask: { title: "t" },
      }),
    ).rejects.toThrowError("プロジェクトが存在しません");
  });

  it("存在しない createdBy を指定すると拒否する", async () => {
    const t = setup();
    const project = await seedProject(t);
    const member = await seedMember(t);
    await t.run((ctx) => ctx.db.delete(member));

    await expect(
      t.mutation(api.issues.create, {
        project,
        title: "x",
        createdBy: member,
        firstTask: { title: "t" },
      }),
    ).rejects.toThrowError("メンバーが存在しません");
  });
});

// --- list（派生ステータス, §5.1） -------------------------------------------

/** 1 Issue（Task 1件）を作成してその参照を返す。 */
const arrangeSingleIssue = async (t: T) => {
  const project = await seedProject(t);
  const member = await seedMember(t);
  const { issue, task } = await t.mutation(api.issues.create, {
    project,
    title: "課題",
    createdBy: member,
    firstTask: { title: "タスク" },
  });
  return { project, member, issue, task };
};

/** list の先頭 Issue（派生ステータス付き）を返す。 */
const statusOf = async (t: T, project: Id<"projects">) => {
  const [issue] = await t.query(api.issues.list, { project });
  return issue;
};

describe("issues.list（派生ステータス）", () => {
  const arrange = arrangeSingleIssue;

  it("全 Task が未着手なら open、進捗は active 基準で集計する", async () => {
    const t = setup();
    const { project } = await arrange(t);

    const issue = await statusOf(t, project);
    expect(issue).toMatchObject({ status: "open", taskCount: 1, doneCount: 0 });
  });

  it("着手済みの Task があれば in_progress になる", async () => {
    const t = setup();
    const { project, task } = await arrange(t);
    await driveTo(t, task, "in_progress");

    expect((await statusOf(t, project)).status).toBe("in_progress");
  });

  it("active が全て done なら done、doneCount に反映される", async () => {
    const t = setup();
    const { project, task } = await arrange(t);
    await driveTo(t, task, "done");

    expect(await statusOf(t, project)).toMatchObject({
      status: "done",
      taskCount: 1,
      doneCount: 1,
    });
  });

  it("active が空（全 Task が canceled）なら canceled、進捗は 0 件になる", async () => {
    const t = setup();
    const { project, task } = await arrange(t);
    await t.mutation(api.tasks.transitionStatus, {
      id: task,
      to: "canceled",
      expectedRevision: 0,
    });

    expect(await statusOf(t, project)).toMatchObject({
      status: "canceled",
      taskCount: 0, // canceled は集計対象外
      doneCount: 0,
    });
  });
});

// --- remove（カスケード削除） -----------------------------------------------

describe("issues.remove", () => {
  it("配下の Task と GitLink を併せて削除する（参照整合性）", async () => {
    const t = setup();
    const project = await seedProject(t);
    const member = await seedMember(t);
    const { issue, task } = await t.mutation(api.issues.create, {
      project,
      title: "課題",
      createdBy: member,
      firstTask: { title: "タスク" },
    });
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
        task,
        repository,
        type: "commit",
        externalRef: "abc123",
        url: "https://github.com/acme/repo/commit/abc123",
      }),
    );

    await t.mutation(api.issues.remove, { id: issue, expectedRevision: 0 });

    expect(await t.run((ctx) => ctx.db.get(issue))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(task))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(link))).toBeNull();
  });

  it("古い revision での削除を競合として拒否する（楽観ロック）", async () => {
    const t = setup();
    const project = await seedProject(t);
    const member = await seedMember(t);
    const { issue } = await t.mutation(api.issues.create, {
      project,
      title: "課題",
      createdBy: member,
      firstTask: { title: "タスク" },
    });

    await expect(
      t.mutation(api.issues.remove, { id: issue, expectedRevision: 99 }),
    ).rejects.toThrowError("競合");
  });
});

// --- getByRef（{key}#{number} 解決・詳細表示用 join） -------------------------

describe("issues.getByRef", () => {
  it("参照を解決し、派生ステータス・作成者名・配下 Task（担当者名付き）を返す", async () => {
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
    const unassigned = await t.mutation(api.tasks.create, {
      issue,
      title: "タスクB",
      createdBy: creator,
    });
    await driveTo(t, task, "in_progress"); // 派生ステータスを動かす

    const found = await t.query(api.issues.getByRef, {
      projectKey: "TASK",
      number: 1,
    });

    expect(found).toMatchObject({
      _id: issue,
      projectKey: "TASK",
      number: 1,
      title: "課題A",
      status: "in_progress", // 子 Task から派生（§5.1）
      createdByName: "Alice",
      tasks: [
        { _id: task, assigneeName: "Bob" },
        { _id: unassigned, assigneeName: null }, // 未割り当ては null
      ],
    });
  });

  it.each([
    { name: "プロジェクトキーが未知", projectKey: "NONE", number: 1 },
    { name: "Issue 番号が未知", projectKey: "TASK", number: 999 },
  ])("$name の場合は null を返す", async ({ projectKey, number }) => {
    const t = setup();
    const project = await seedProject(t, { key: "TASK" });
    const member = await seedMember(t);
    await t.mutation(api.issues.create, {
      project,
      title: "課題",
      createdBy: member,
      firstTask: { title: "タスク" },
    });

    expect(
      await t.query(api.issues.getByRef, { projectKey, number }),
    ).toBeNull();
  });
});
