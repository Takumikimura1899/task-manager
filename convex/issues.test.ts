// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type As,
  seedAuthedMember,
  seedMember,
  seedOwnedProject,
  seedProject,
  seedProjectMember,
  seedProjectWithOutsider,
  setup,
  type T,
} from "../test/convexSupport";

/**
 * Issue Core ミューテーション／クエリの結合テスト（基本設計書 §3/§5.1/ADR-9/ADR-10）。
 *
 * 検証の中心は Issue 固有の2つの不変条件:
 * - INVARIANT-5: Issue は常に ≥1 Task を持つ（作成は最初の Task を伴う／削除はカスケード）
 * - §5.1: Issue.status は保持せず子 Task 群から一意に派生する
 * deriveIssueStatus 自体は lib/issueStatus.test.ts で単体検証済み。ここでは
 * ミューテーション経由で Task を遷移させたとき、クエリが正しい派生状態を返すかを見る。
 *
 * 全公開関数は認証ゲート（Issue #1 PR2）配下のため、呼び出しは
 * seedAuthedMember が返す `as`（認証済み identity）で行う。createdBy 引数は
 * サーバ側で actor に強制されるため公開 API から消えている（詳細は
 * convex/lib/auth.test.ts）。
 */

/** active な Task の線形な前進経路（backlog はこの手前の初期状態）。 */
const FORWARD_PATH = ["todo", "in_progress", "in_review", "done"] as const;

/** Task を状態機械に沿って target まで前進させる（revision を追跡）。 */
const driveTo = async (
  as: As,
  taskId: Id<"tasks">,
  target: (typeof FORWARD_PATH)[number],
) => {
  let rev = 0;
  for (const to of FORWARD_PATH) {
    await as.mutation(api.tasks.transitionStatus, {
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
  it("Issue と最初の Task を同時に採番して作成し、createdBy を actor に強制する（INVARIANT-5）", async () => {
    const t = setup();
    const { as, memberId: member, project } = await seedOwnedProject(t);

    const { issue, task } = await as.mutation(api.issues.create, {
      project,
      title: "課題A",
      firstTask: { title: "タスクA", priority: "high" },
    });

    const issueDoc = await t.run((ctx) => ctx.db.get(issue));
    const taskDoc = await t.run((ctx) => ctx.db.get(task));

    expect(issueDoc).toMatchObject({
      project,
      number: 1,
      title: "課題A",
      createdBy: member, // 呼び出し元の actor が強制される（引数化はできない）
    });
    // Task は Issue に従属し、project は Issue から解決される
    expect(taskDoc).toMatchObject({
      issue,
      project,
      number: 1,
      status: "backlog",
      priority: "high",
      createdBy: member,
    });

    // 採番カウンタは Issue／Task で独立に前進する（INVARIANT-1）
    const proj = await t.run((ctx) => ctx.db.get(project));
    expect(proj).toMatchObject({ nextIssueNumber: 2, nextTaskNumber: 2 });
  });

  it("存在しないプロジェクトを指定すると拒否する", async () => {
    const t = setup();
    const { as, project } = await seedOwnedProject(t);
    await t.run((ctx) => ctx.db.delete(project));

    // projectMutation が resolveProject（projectOfProjectId）の段階で拒否するため
    // 汎用メッセージになる（ADR-11 設計書 §3.5 手順2）。
    await expect(
      as.mutation(api.issues.create, {
        project,
        title: "x",
        firstTask: { title: "t" },
      }),
    ).rejects.toThrowError("指定された対象が存在しません");
  });
});

// --- list（派生ステータス, §5.1） -------------------------------------------

/** 1 Issue（Task 1件）を作成してその参照を返す。 */
const arrangeSingleIssue = async (t: T) => {
  const { as, memberId: member, project } = await seedOwnedProject(t);
  const { issue, task } = await as.mutation(api.issues.create, {
    project,
    title: "課題",
    firstTask: { title: "タスク" },
  });
  return { as, project, member, issue, task };
};

/** list の先頭 Issue（派生ステータス付き）を返す。 */
const statusOf = async (as: As, project: Id<"projects">) => {
  const [issue] = (await as.query(api.issues.list, { project }))!;
  return issue;
};

describe("issues.list（派生ステータス）", () => {
  const arrange = arrangeSingleIssue;

  // 中間状態（in_progress/done への遷移）の deriveIssueStatus 自体の分岐網羅は
  // convex/lib/issueStatus.test.ts が保証する。ここでは open（初期状態）と
  // canceled（進捗の集計除外という副作用を伴う）の2点で、ミューテーション経由の
  // 配線を固定する。
  it("全 Task が未着手なら open、進捗は active 基準で集計する", async () => {
    const t = setup();
    const { as, project } = await arrange(t);

    const issue = await statusOf(as, project);
    expect(issue).toMatchObject({ status: "open", taskCount: 1, doneCount: 0 });
  });

  it("active が空（全 Task が canceled）なら canceled、進捗は 0 件になる", async () => {
    const t = setup();
    const { as, project, task } = await arrange(t);
    await as.mutation(api.tasks.transitionStatus, {
      id: task,
      to: "canceled",
      expectedRevision: 0,
    });

    expect(await statusOf(as, project)).toMatchObject({
      status: "canceled",
      taskCount: 0, // canceled は集計対象外
      doneCount: 0,
    });
  });

  // doneCount 集計（active.filter(status === "done").length）は issues.ts の
  // list に直書きされたインラインロジックで、lib 層（issueStatus.ts）に
  // 保証元を持たない。done の Task を含むケースを1本、実際に doneCount が
  // 非0で加算されることまで固定する。
  it("done の Task を含む Issue では doneCount に加算する", async () => {
    const t = setup();
    const { as, project, task } = await arrange(t);
    await driveTo(as, task, "done");

    expect(await statusOf(as, project)).toMatchObject({
      status: "done",
      taskCount: 1,
      doneCount: 1,
    });
  });
});

// --- priority（未指定は "none" に正規化・作成時指定・更新） -------------------

describe("issues の priority", () => {
  it('priority 未指定で作成すると list / getByRef で "none" になる', async () => {
    const t = setup();
    const { as, project } = await seedOwnedProject(t);
    await as.mutation(api.issues.create, {
      project,
      title: "課題",
      firstTask: { title: "タスク" },
    });

    const [listed] = (await as.query(api.issues.list, { project }))!;
    expect(listed).toMatchObject({ priority: "none" });

    const found = await as.query(api.issues.getByRef, {
      projectKey: "TASK",
      number: 1,
    });
    expect(found).toMatchObject({ priority: "none" });
  });

  it("priority を指定して作成すると反映され、update で変更できる", async () => {
    const t = setup();
    const { as, project } = await seedOwnedProject(t);
    const { issue } = await as.mutation(api.issues.create, {
      project,
      title: "課題",
      priority: "high",
      firstTask: { title: "タスク" },
    });

    expect(
      await as.query(api.issues.getByRef, { projectKey: "TASK", number: 1 }),
    ).toMatchObject({ priority: "high" });

    await as.mutation(api.issues.update, {
      id: issue,
      expectedRevision: 0,
      priority: "urgent",
    });

    expect(await t.run((ctx) => ctx.db.get(issue))).toMatchObject({
      priority: "urgent",
      revision: 1,
    });
  });
});

// --- list（estimateTotal / actualTotal の集計） ------------------------------

describe("issues.list（estimateTotal / actualTotal）", () => {
  it("active な Task の estimate/actual を合計し、canceled は除外、未設定は0扱いにする", async () => {
    const t = setup();
    const { as, project } = await seedOwnedProject(t);
    const { issue, task: first } = await as.mutation(api.issues.create, {
      project,
      title: "課題",
      firstTask: { title: "タスク1" },
    });
    // 2つ目は estimate/actual を未設定のまま（0 扱いになることを検証する）
    await as.mutation(api.tasks.create, {
      issue,
      title: "タスク2",
    });
    const canceled = await as.mutation(api.tasks.create, {
      issue,
      title: "タスク3（canceledにする）",
    });

    await as.mutation(api.tasks.updateFields, {
      id: first,
      expectedRevision: 0,
      estimate: 5,
      actual: 2,
    });
    // canceled にするタスクにも工数を入れておくが、集計からは除外されるはず
    await as.mutation(api.tasks.updateFields, {
      id: canceled,
      expectedRevision: 0,
      estimate: 10,
      actual: 10,
    });
    await as.mutation(api.tasks.transitionStatus, {
      id: canceled,
      to: "canceled",
      expectedRevision: 1,
    });

    const [found] = (await as.query(api.issues.list, { project }))!;

    expect(found).toMatchObject({
      taskCount: 2, // canceled を除いた active 数
      estimateTotal: 5, // タスク1(5) + タスク2(未設定=0)、canceled(10)は除外
      actualTotal: 2, // タスク1(2) + タスク2(未設定=0)、canceled(10)は除外
    });
  });
});

// --- list（assignees、担当者フィルタ用集計・Issue #91） ---------------------

describe("issues.list（assignees）", () => {
  it("未割り当ての Task のみなら空配列を返す", async () => {
    const t = setup();
    const { as, project } = await arrangeSingleIssue(t);

    const issue = await statusOf(as, project);
    expect(issue.assignees).toEqual([]);
  });

  it("active な Task の担当者を重複なく列挙する", async () => {
    const t = setup();
    const {
      as,
      memberId: alice,
      project,
    } = await seedOwnedProject(t, {
      name: "Alice",
    });
    const bob = await seedMember(t, {
      name: "Bob",
      email: "bob@example.com",
    });
    // 設計書 §10 D2: assignee は project の参加 Member のみ許可されるため、
    // Bob を member として参加させる。
    await seedProjectMember(t, project, bob, "member");
    const { issue } = await as.mutation(api.issues.create, {
      project,
      title: "課題",
      firstTask: { title: "タスク1", assignee: alice },
    });
    // Alice への重複割り当て（集計は重複排除されるはず）
    await as.mutation(api.tasks.create, {
      issue,
      title: "タスク2",
      assignee: alice,
    });
    await as.mutation(api.tasks.create, {
      issue,
      title: "タスク3",
      assignee: bob,
    });
    // 未割り当ての Task（assignees に影響しないはず）
    await as.mutation(api.tasks.create, {
      issue,
      title: "タスク4",
    });

    const [found] = (await as.query(api.issues.list, { project }))!;

    expect(found.assignees).toHaveLength(2);
    expect(new Set(found.assignees)).toEqual(new Set([alice, bob]));
  });

  it("canceled にした Task の担当者は除外する", async () => {
    const t = setup();
    const { as, memberId: member, project } = await seedOwnedProject(t);
    const { task } = await as.mutation(api.issues.create, {
      project,
      title: "課題",
      firstTask: { title: "タスク", assignee: member },
    });
    await as.mutation(api.tasks.transitionStatus, {
      id: task,
      to: "canceled",
      expectedRevision: 0,
    });

    const [found] = (await as.query(api.issues.list, { project }))!;

    expect(found.assignees).toEqual([]);
  });
});

// --- listInProgress（ActiveIssueStrip 向け軽量版） ---------------------------

describe("issues.listInProgress", () => {
  it("in_progress の Issue のみを返す（open/done/canceled は含まない）", async () => {
    const t = setup();
    const { as, project } = await seedOwnedProject(t);

    // open のまま
    await as.mutation(api.issues.create, {
      project,
      title: "未着手の課題",
      firstTask: { title: "タスクA" },
    });

    // in_progress にする
    const { task: inProgressTask } = await as.mutation(api.issues.create, {
      project,
      title: "進行中の課題",
      firstTask: { title: "タスクB" },
    });
    await driveTo(as, inProgressTask, "in_progress");

    // done にする
    const { task: doneTask } = await as.mutation(api.issues.create, {
      project,
      title: "完了済みの課題",
      firstTask: { title: "タスクC" },
    });
    await driveTo(as, doneTask, "done");

    // canceled にする
    const { task: canceledTask } = await as.mutation(api.issues.create, {
      project,
      title: "中止された課題",
      firstTask: { title: "タスクD" },
    });
    await as.mutation(api.tasks.transitionStatus, {
      id: canceledTask,
      to: "canceled",
      expectedRevision: 0,
    });

    const result = (await as.query(api.issues.listInProgress, { project }))!;

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ title: "進行中の課題" });
  });

  it("返却フィールドを最小セット（_id/number/title/taskCount/doneCount）に絞る", async () => {
    const t = setup();
    const { as, project, task } = await arrangeSingleIssue(t);
    await driveTo(as, task, "in_progress");

    const [found] = (await as.query(api.issues.listInProgress, { project }))!;

    expect(Object.keys(found).toSorted()).toEqual([
      "_id",
      "doneCount",
      "number",
      "taskCount",
      "title",
    ]);
    expect(found).toMatchObject({
      number: 1,
      title: "課題",
      taskCount: 1,
      doneCount: 0,
    });
  });
});

// --- update（タイトル・説明の編集） ------------------------------------------

describe("issues.update", () => {
  it("タイトルと説明を更新し revision を進める", async () => {
    const t = setup();
    const { as, issue } = await arrangeSingleIssue(t);

    await as.mutation(api.issues.update, {
      id: issue,
      expectedRevision: 0,
      title: "改題した課題",
      description: "詳細を追記",
    });

    expect(await t.run((ctx) => ctx.db.get(issue))).toMatchObject({
      title: "改題した課題",
      description: "詳細を追記",
      revision: 1,
    });
  });

  it("未指定のフィールドは変更しない", async () => {
    const t = setup();
    const { as, project } = await seedOwnedProject(t);
    const { issue } = await as.mutation(api.issues.create, {
      project,
      title: "課題",
      description: "元の説明",
      firstTask: { title: "タスク" },
    });

    await as.mutation(api.issues.update, {
      id: issue,
      expectedRevision: 0,
      title: "改題のみ",
    });

    expect(await t.run((ctx) => ctx.db.get(issue))).toMatchObject({
      title: "改題のみ",
      description: "元の説明",
      revision: 1,
    });
  });

  it("古い revision での更新を競合として拒否し、何も書き換えない（楽観ロック）", async () => {
    const t = setup();
    const { as, issue } = await arrangeSingleIssue(t);

    await expect(
      as.mutation(api.issues.update, {
        id: issue,
        expectedRevision: 99,
        title: "更新されないはず",
      }),
    ).rejects.toThrowError("競合");

    expect(await t.run((ctx) => ctx.db.get(issue))).toMatchObject({
      title: "課題",
      revision: 0,
    });
  });

  it("存在しない Issue への更新を拒否する", async () => {
    const t = setup();
    const { as, issue } = await arrangeSingleIssue(t);
    await t.run(async (ctx) => {
      // 配下 Task ごと消して Id だけ残す（INVARIANT-5 を壊した状態は作らない）
      for (const task of await ctx.db
        .query("tasks")
        .withIndex("by_issue", (q) => q.eq("issue", issue))
        .collect()) {
        await ctx.db.delete(task._id);
      }
      await ctx.db.delete(issue);
    });

    // projectMutation が resolveProject（projectOfIssue）の段階で拒否するため
    // 汎用メッセージになる（ADR-11 設計書 §3.5 手順2）。
    await expect(
      as.mutation(api.issues.update, {
        id: issue,
        expectedRevision: 0,
        title: "x",
      }),
    ).rejects.toThrowError("指定された対象が存在しません");
  });
});

// --- remove（カスケード削除） -----------------------------------------------

describe("issues.remove", () => {
  it("配下の Task と GitLink を併せて削除する（参照整合性）", async () => {
    const t = setup();
    const { as, project } = await seedOwnedProject(t);
    const { issue, task } = await as.mutation(api.issues.create, {
      project,
      title: "課題",
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

    await as.mutation(api.issues.remove, { id: issue, expectedRevision: 0 });

    expect(await t.run((ctx) => ctx.db.get(issue))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(task))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(link))).toBeNull();
  });

  it("古い revision での削除を競合として拒否する（楽観ロック）", async () => {
    const t = setup();
    const { as, project } = await seedOwnedProject(t);
    const { issue } = await as.mutation(api.issues.create, {
      project,
      title: "課題",
      firstTask: { title: "タスク" },
    });

    await expect(
      as.mutation(api.issues.remove, { id: issue, expectedRevision: 99 }),
    ).rejects.toThrowError("競合");
  });
});

// --- getIdByRef（{key}#{number} → _id の軽量解決） ---------------------------

describe("issues.getIdByRef", () => {
  it("参照を解決して _id だけを返す", async () => {
    const t = setup();
    const { as, project } = await seedOwnedProject(t);
    const { issue } = await as.mutation(api.issues.create, {
      project,
      title: "課題",
      firstTask: { title: "タスク" },
    });

    expect(
      await as.query(api.issues.getIdByRef, { projectKey: "TASK", number: 1 }),
    ).toBe(issue);
  });
});

// --- getByRef（{key}#{number} 解決・詳細表示用 join） -------------------------

describe("issues.getByRef", () => {
  it("参照を解決し、派生ステータス・作成者名・配下 Task（担当者名付き）を返す", async () => {
    const t = setup();
    const { as, project } = await seedOwnedProject(t, {
      name: "Alice",
    });
    const assignee = await seedMember(t, {
      name: "Bob",
      email: "bob@example.com",
    });
    // 設計書 §10 D2: assignee は project の参加 Member のみ許可されるため、
    // Bob を member として参加させる。
    await seedProjectMember(t, project, assignee, "member");
    const { issue, task } = await as.mutation(api.issues.create, {
      project,
      title: "課題A",
      firstTask: { title: "タスクA", assignee },
    });
    const unassigned = await as.mutation(api.tasks.create, {
      issue,
      title: "タスクB",
    });
    await driveTo(as, task, "in_progress"); // 派生ステータスを動かす

    const found = await as.query(api.issues.getByRef, {
      projectKey: "TASK",
      number: 1,
    });

    expect(found).toMatchObject({
      _id: issue,
      projectKey: "TASK",
      number: 1,
      title: "課題A",
      status: "in_progress", // 子 Task から派生（§5.1）
      createdByName: "Alice", // createdBy は actor（Alice）に強制される
      tasks: [
        { _id: task, assigneeName: "Bob" },
        { _id: unassigned, assigneeName: null }, // 未割り当ては null
      ],
    });
  });

  // 参照解決の前段（findIssueByRef）は getIdByRef と共通のため、null 系はまとめて検証する。
  it.each([
    { name: "プロジェクトキーが未知", projectKey: "NONE", number: 1 },
    { name: "Issue 番号が未知", projectKey: "TASK", number: 999 },
  ])(
    "$name の場合は getByRef / getIdByRef とも null を返す",
    async ({ projectKey, number }) => {
      const t = setup();
      const { as, project } = await seedOwnedProject(t);
      await as.mutation(api.issues.create, {
        project,
        title: "課題",
        firstTask: { title: "タスク" },
      });

      expect(
        await as.query(api.issues.getByRef, { projectKey, number }),
      ).toBeNull();
      expect(
        await as.query(api.issues.getIdByRef, { projectKey, number }),
      ).toBeNull();
    },
  );
});

// --- 認可（ADR-11 §4: projectQuery/projectMutation の membership ゲート） -----

describe("issues の認可（ADR-11 §4）", () => {
  it("非参加者は issues.list を拒否される", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t);

    await expect(as.query(api.issues.list, { project })).rejects.toThrowError(
      "このプロジェクトに参加していません",
    );
  });

  it("非参加者は issues.getByRef を拒否される", async () => {
    const t = setup();
    const { asOwner, project, asOutsider } = await seedProjectWithOutsider(t);
    await asOwner.mutation(api.issues.create, {
      project,
      title: "課題",
      firstTask: { title: "タスク" },
    });

    await expect(
      asOutsider.query(api.issues.getByRef, { projectKey: "TASK", number: 1 }),
    ).rejects.toThrowError("このプロジェクトに参加していません");
  });

  it("非参加者による issues.create は拒否され、Issue も Task も作られない", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t);

    await expect(
      as.mutation(api.issues.create, {
        project,
        title: "侵入課題",
        firstTask: { title: "タスク" },
      }),
    ).rejects.toThrowError("このプロジェクトに参加していません");

    expect(await t.run((ctx) => ctx.db.query("issues").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("tasks").collect())).toEqual([]);
  });

  it("非参加者による issues.update は拒否され、DB は変わらない", async () => {
    const t = setup();
    const { asOwner, project, asOutsider } = await seedProjectWithOutsider(t);
    const { issue } = await asOwner.mutation(api.issues.create, {
      project,
      title: "課題",
      firstTask: { title: "タスク" },
    });

    await expect(
      asOutsider.mutation(api.issues.update, {
        id: issue,
        expectedRevision: 0,
        title: "改題を試みる",
      }),
    ).rejects.toThrowError("このプロジェクトに参加していません");

    expect(await t.run((ctx) => ctx.db.get(issue))).toMatchObject({
      title: "課題",
      revision: 0,
    });
  });

  it("非参加 Member を firstTask.assignee に指定した issues.create を拒否する（設計書 §10 D2）", async () => {
    const t = setup();
    const { as, project } = await seedOwnedProject(t);
    // outsider はどのプロジェクトにも参加していない Member（実在はする）
    const outsider = await seedMember(t, {
      name: "Outsider",
      email: "outsider@example.com",
    });

    await expect(
      as.mutation(api.issues.create, {
        project,
        title: "課題",
        firstTask: { title: "タスク", assignee: outsider },
      }),
    ).rejects.toThrowError(
      "指定されたメンバーはこのプロジェクトに参加していません",
    );

    // Issue も Task も作られない（同一トランザクション）
    expect(await t.run((ctx) => ctx.db.query("issues").collect())).toEqual([]);
  });

  // 全 mutation の操作主体が owner だと、permission 配線ミス（例: update に
  // owner 専用 permission を誤配線してしまう）があっても owner はロール横断で
  // 全許可を持つためテストが緑のまま気づけない。member ロールでの成功パスを
  // 別途固定する（監査 CONFIRMED 指摘・tasks.test.ts の tasks.create/
  // transitionStatus と対）。
  it("member ロールでも issues.update に成功する（permission task.*）", async () => {
    const t = setup();
    const { as: asOwner, project } = await seedOwnedProject(t);
    const { as: asMember, memberId: memberActor } = await seedAuthedMember(t, {
      email: "member@example.com",
    });
    await seedProjectMember(t, project, memberActor, "member");
    const { issue } = await asOwner.mutation(api.issues.create, {
      project,
      title: "課題",
      firstTask: { title: "タスク" },
    });

    await asMember.mutation(api.issues.update, {
      id: issue,
      expectedRevision: 0,
      title: "member が更新したタイトル",
    });

    expect(await t.run((ctx) => ctx.db.get(issue))).toMatchObject({
      title: "member が更新したタイトル",
    });
  });
});
