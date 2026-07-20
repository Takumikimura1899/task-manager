// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  type As,
  TEST_WEBHOOK_ENCRYPTION_KEY,
  getTask,
  listTaskGitLinks,
  listWebhookDeliveries,
  seedAuthedMember,
  seedGitLink,
  seedProject,
  seedRepository,
  type T,
} from "../test/convexSupport";

/**
 * Webhook internal 関数の結合テスト（基本設計書 §5 自動遷移 / §7）。
 *
 * HTTP 層（署名検証・冪等化・ディスパッチ）は http.test.ts で検証し、ここでは
 * internal ミューテーション単位で「Git イベントが DB の最終状態にどう反映されるか」を
 * 固定する（古典学派・結合テスト層）。参照抽出（gitRef）・遷移表（gitAutomation）の
 * 純粋関数は lib/*.test.ts で単体検証済みで、ここでは結線を検証する。
 *
 * 冪等マーキングとイベント反映は processEvent が単一トランザクションで行う
 * （Issue #12）。処理失敗時にマーカーが残らず再送で再処理できることも
 * ここで固定する（processEvent の describe を参照）。
 */

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const setup = () => convexTest(schema, modules);

// seedRepository が webhookSecret を暗号化するため、本番同様に環境変数で鍵を注入する
beforeEach(() => {
  vi.stubEnv("WEBHOOK_ENCRYPTION_KEY", TEST_WEBHOOK_ENCRYPTION_KEY);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

/** Task を取得し、存在（非 null）を表明してから素のドキュメントを返す。 */
const loadTask = async (t: T, id: Id<"tasks">) => {
  const task = await getTask(t, id);
  expect(task).not.toBeNull();
  return task!;
};

/**
 * key=TASK のプロジェクトに Issue と TASK-1（backlog）、連携先リポジトリを用意する。
 * Issue 作成は公開 API（認証ゲート配下）なので seedAuthedMember の `as` を使う。
 * internal ミューテーション（handleBranchCreated 等）自体は無認証のままでよい。
 */
const seedScenario = async (t: T) => {
  const { as, memberId: member } = await seedAuthedMember(t);
  const project = await seedProject(t);
  const { issue, task } = await as.mutation(api.issues.create, {
    project,
    title: "課題",
    firstTask: { title: "最初のタスク" },
  });
  const repository = await seedRepository(t, project);
  return { as, project, member, issue, task, repository };
};

/** 同じ Issue に Task を1件追加する（連番で TASK-2, TASK-3, … になる）。 */
const addTask = (as: As, issue: Id<"issues">, title = "追加タスク") =>
  as.mutation(api.tasks.create, { issue, title });

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

// --- handleBranchCreated（findTask 照合 + branch_created 遷移） ---------------

describe("webhooks.handleBranchCreated", () => {
  it("ブランチ名の参照に一致するタスクを todo → in_progress に進める", async () => {
    const t = setup();
    const { as, project, task } = await seedScenario(t);
    await driveTo(as, task, "todo");

    await t.mutation(internal.webhooks.handleBranchCreated, {
      projectId: project,
      branchName: "feature/TASK-1-login",
    });

    const after = await loadTask(t, task);
    expect(after.status).toBe("in_progress");
    expect(after.revision).toBe(2); // todo への手動遷移(+1) と自動遷移(+1)
  });

  it.each([
    {
      name: "プロジェクトキーが一致しない",
      branchName: "feature/OTHER-1-login",
    },
    { name: "該当番号のタスクがない", branchName: "feature/TASK-999-login" },
    { name: "タスク参照を含まない", branchName: "feature/login" },
  ])("$name ブランチ名は無視し、タスクを変更しない", async ({ branchName }) => {
    const t = setup();
    const { as, project, task } = await seedScenario(t);
    await driveTo(as, task, "todo");

    await t.mutation(internal.webhooks.handleBranchCreated, {
      projectId: project,
      branchName,
    });

    const after = await loadTask(t, task);
    expect(after.status).toBe("todo");
    expect(after.revision).toBe(1); // 自動遷移が走っていない
  });
});

// --- 自動遷移の共通規則（applyTransition: 前進のみ + 末尾 rank） --------------

describe("Git イベントによる自動遷移（applyTransition）", () => {
  it.each([
    { name: "既に目標状態に到達している", from: "in_progress" },
    { name: "手動で先へ進めてある", from: "in_review" },
    { name: "完了済みの", from: "done" },
  ] as const)(
    "branch_created は $name タスク（$from）を上書きしない（前進のみ）",
    async ({ from }) => {
      const t = setup();
      const { as, project, task } = await seedScenario(t);
      await driveTo(as, task, from);
      const before = await loadTask(t, task);

      await t.mutation(internal.webhooks.handleBranchCreated, {
        projectId: project,
        branchName: "TASK-1-fix",
      });

      const after = await loadTask(t, task);
      expect(after.status).toBe(from);
      expect(after.revision).toBe(before.revision);
    },
  );

  it("backlog からの branch_created は隣接遷移でないため適用しない（スキップ前進禁止）", async () => {
    const t = setup();
    const { project, task } = await seedScenario(t);

    await t.mutation(internal.webhooks.handleBranchCreated, {
      projectId: project,
      branchName: "TASK-1-fix",
    });

    expect((await loadTask(t, task)).status).toBe("backlog");
  });

  it("自動遷移したタスクは遷移先列の末尾 rank に置かれる", async () => {
    const t = setup();
    const { as, project, issue, task } = await seedScenario(t);
    const second = await addTask(as, issue); // TASK-2
    await driveTo(as, second, "in_progress"); // 遷移先列に既存タスクを置いておく
    await driveTo(as, task, "todo");

    await t.mutation(internal.webhooks.handleBranchCreated, {
      projectId: project,
      branchName: "TASK-1-fix",
    });

    const moved = await loadTask(t, task);
    const existing = await loadTask(t, second);
    expect(moved.status).toBe("in_progress");
    expect(moved.rank > existing.rank).toBe(true); // 既存タスクの後ろ（列末尾）
  });
});

// --- handlePush（commit メッセージの [KEY-番号] → GitLink） -------------------

/** handlePush へ渡す commit のファクトリ。 */
const createCommit = (
  overrides: Partial<{ message: string; sha: string; url: string }> = {},
) => ({
  message: "[TASK-1] fix: バグ修正",
  sha: "abc123",
  url: "https://github.com/acme/repo/commit/abc123",
  ...overrides,
});

describe("webhooks.handlePush", () => {
  it("[KEY-番号] を含むコミットに GitLink(commit) を追加する（ステータス遷移はしない）", async () => {
    const t = setup();
    const { project, task, repository } = await seedScenario(t);

    await t.mutation(internal.webhooks.handlePush, {
      repositoryId: repository,
      projectId: project,
      commits: [createCommit()],
    });

    expect(await listTaskGitLinks(t, task)).toMatchObject([
      {
        repository,
        type: "commit",
        externalRef: "abc123",
        url: "https://github.com/acme/repo/commit/abc123",
      },
    ]);
    // push は自動遷移の対象外（§5）
    const after = await loadTask(t, task);
    expect(after.status).toBe("backlog");
    expect(after.revision).toBe(0);
  });

  it("複数コミットの参照をそれぞれのタスクへ GitLink として追加する", async () => {
    const t = setup();
    const { as, project, issue, task, repository } = await seedScenario(t);
    const second = await addTask(as, issue); // TASK-2

    await t.mutation(internal.webhooks.handlePush, {
      repositoryId: repository,
      projectId: project,
      commits: [
        createCommit({ message: "[TASK-1] fix" }),
        createCommit({ message: "[TASK-2] refactor", sha: "def456" }),
      ],
    });

    expect(await listTaskGitLinks(t, task)).toMatchObject([
      { type: "commit", externalRef: "abc123" },
    ]);
    expect(await listTaskGitLinks(t, second)).toMatchObject([
      { type: "commit", externalRef: "def456" },
    ]);
  });

  it("1コミットに複数の参照があれば、参照された各タスクに GitLink を追加する（Issue #38）", async () => {
    // upsertGitLink は (task, repository, type, externalRef=sha) で同定するため、
    // 同一 sha でも参照されたタスクごとに独立したリンクが作られる。
    const t = setup();
    const { as, project, issue, task, repository } = await seedScenario(t);
    const second = await addTask(as, issue); // TASK-2

    await t.mutation(internal.webhooks.handlePush, {
      repositoryId: repository,
      projectId: project,
      commits: [createCommit({ message: "[TASK-1][TASK-2] refactor" })],
    });

    expect(await listTaskGitLinks(t, task)).toMatchObject([
      { type: "commit", externalRef: "abc123" },
    ]);
    expect(await listTaskGitLinks(t, second)).toMatchObject([
      { type: "commit", externalRef: "abc123" },
    ]);
  });

  it("複数タスク参照コミットの再送は各タスクのリンクを増やさない（upsert）", async () => {
    const t = setup();
    const { as, project, issue, task, repository } = await seedScenario(t);
    const second = await addTask(as, issue); // TASK-2
    const args = {
      repositoryId: repository,
      projectId: project,
      commits: [createCommit({ message: "[TASK-1][TASK-2] refactor" })],
    };
    await t.mutation(internal.webhooks.handlePush, args);

    await t.mutation(internal.webhooks.handlePush, args);

    expect(await listTaskGitLinks(t, task)).toHaveLength(1);
    expect(await listTaskGitLinks(t, second)).toHaveLength(1);
  });

  it.each([
    { name: "角括弧のない参照（規約外）", message: "TASK-1 を修正" },
    { name: "未知のタスク番号", message: "[TASK-999] 修正" },
    { name: "別プロジェクトキーの参照", message: "[OTHER-1] 修正" },
  ])("$name を含むコミットは無視する", async ({ message }) => {
    const t = setup();
    const { project, task, repository } = await seedScenario(t);

    await t.mutation(internal.webhooks.handlePush, {
      repositoryId: repository,
      projectId: project,
      commits: [createCommit({ message })],
    });

    expect(await listTaskGitLinks(t, task)).toHaveLength(0);
  });

  it("同じ sha の再送は GitLink を増やさず URL を更新する（upsert）", async () => {
    const t = setup();
    const { project, task, repository } = await seedScenario(t);
    await seedGitLink(
      t,
      { task, repository },
      { type: "commit", externalRef: "abc123", url: "https://old.example.com" },
    );

    await t.mutation(internal.webhooks.handlePush, {
      repositoryId: repository,
      projectId: project,
      commits: [createCommit()],
    });

    const links = await listTaskGitLinks(t, task);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      externalRef: "abc123",
      url: "https://github.com/acme/repo/commit/abc123",
    });
  });
});

// --- handlePullRequest（GitLink upsert + PR state / action ごとの遷移） -------

/** handlePullRequest へ渡す引数のファクトリ（既定はタイトルに TASK-1 参照を持つ opened）。 */
const createPrArgs = (
  ids: { repositoryId: Id<"repositories">; projectId: Id<"projects"> },
  overrides: Partial<{
    action: string;
    merged: boolean;
    draft: boolean;
    number: number;
    url: string;
    title: string;
    body: string;
    branch: string;
  }> = {},
) => ({
  ...ids,
  action: "opened",
  merged: false,
  draft: false,
  number: 5,
  url: "https://github.com/acme/repo/pull/5",
  title: "TASK-1 ログイン修正",
  body: "",
  branch: "feature/no-task-ref",
  ...overrides,
});

describe("webhooks.handlePullRequest", () => {
  it.each([
    {
      name: "Draft PR",
      action: "opened",
      draft: true,
      merged: false,
      prState: "draft",
    },
    {
      name: "通常の PR",
      action: "opened",
      draft: false,
      merged: false,
      prState: "open",
    },
    {
      name: "マージ済みクローズ",
      action: "closed",
      draft: false,
      merged: true,
      prState: "merged",
    },
    {
      name: "未マージクローズ",
      action: "closed",
      draft: false,
      merged: false,
      prState: "closed",
    },
  ] as const)(
    "$name は prState=$prState の GitLink(pull_request) を記録する",
    async ({ action, draft, merged, prState }) => {
      const t = setup();
      const { project, task, repository } = await seedScenario(t);

      await t.mutation(
        internal.webhooks.handlePullRequest,
        createPrArgs(
          { repositoryId: repository, projectId: project },
          { action, draft, merged },
        ),
      );

      expect(await listTaskGitLinks(t, task)).toMatchObject([
        {
          type: "pull_request",
          externalRef: "5",
          url: "https://github.com/acme/repo/pull/5",
          prState,
        },
      ]);
    },
  );

  it.each([
    {
      name: "opened で todo → in_progress",
      action: "opened",
      merged: false,
      from: "todo",
      expected: "in_progress",
    },
    {
      name: "reopened で todo → in_progress",
      action: "reopened",
      merged: false,
      from: "todo",
      expected: "in_progress",
    },
    {
      name: "ready_for_review で in_progress → in_review",
      action: "ready_for_review",
      merged: false,
      from: "in_progress",
      expected: "in_review",
    },
    {
      name: "closed（マージ済み）で in_review → done",
      action: "closed",
      merged: true,
      from: "in_review",
      expected: "done",
    },
    {
      name: "closed（未マージ）で in_review → in_progress へ差し戻し",
      action: "closed",
      merged: false,
      from: "in_review",
      expected: "in_progress",
    },
    {
      name: "closed（未マージ）は in_review 以外では差し戻さない",
      action: "closed",
      merged: false,
      from: "in_progress",
      expected: "in_progress",
    },
    {
      name: "synchronize は遷移の対象外",
      action: "synchronize",
      merged: false,
      from: "in_progress",
      expected: "in_progress",
    },
  ] as const)("$name", async ({ action, merged, from, expected }) => {
    const t = setup();
    const { as, project, task, repository } = await seedScenario(t);
    await driveTo(as, task, from);

    await t.mutation(
      internal.webhooks.handlePullRequest,
      createPrArgs(
        { repositoryId: repository, projectId: project },
        { action, merged },
      ),
    );

    expect((await loadTask(t, task)).status).toBe(expected);
  });

  it("参照はタイトルを最優先で解決する（本文の参照より優先）", async () => {
    const t = setup();
    const { as, project, issue, task, repository } = await seedScenario(t);
    const second = await addTask(as, issue); // TASK-2

    await t.mutation(
      internal.webhooks.handlePullRequest,
      createPrArgs(
        { repositoryId: repository, projectId: project },
        { title: "TASK-2 対応", body: "TASK-1 も関連" },
      ),
    );

    expect(await listTaskGitLinks(t, second)).toHaveLength(1);
    expect(await listTaskGitLinks(t, task)).toHaveLength(0);
  });

  it.each([
    {
      name: "本文",
      overrides: {
        title: "リファクタリング",
        body: "TASK-1 を解決する",
        branch: "feature/x",
      },
    },
    {
      name: "ブランチ名",
      overrides: {
        title: "リファクタリング",
        body: "説明なし",
        branch: "feature/TASK-1-refactor",
      },
    },
  ])("タイトルに参照がなければ $name から解決する", async ({ overrides }) => {
    const t = setup();
    const { project, task, repository } = await seedScenario(t);

    await t.mutation(
      internal.webhooks.handlePullRequest,
      createPrArgs({ repositoryId: repository, projectId: project }, overrides),
    );

    expect(await listTaskGitLinks(t, task)).toHaveLength(1);
  });

  it("どこにもタスク参照のない PR は無視する", async () => {
    const t = setup();
    const { project, task, repository } = await seedScenario(t);

    await t.mutation(
      internal.webhooks.handlePullRequest,
      createPrArgs(
        { repositoryId: repository, projectId: project },
        { title: "リファクタリング", body: "", branch: "feature/refactor" },
      ),
    );

    expect(await listTaskGitLinks(t, task)).toHaveLength(0);
  });

  it("同じ PR 番号の再送は GitLink を増やさず prState を更新する（upsert）", async () => {
    const t = setup();
    const { project, task, repository } = await seedScenario(t);
    const ids = { repositoryId: repository, projectId: project };

    await t.mutation(internal.webhooks.handlePullRequest, createPrArgs(ids)); // opened
    await t.mutation(
      internal.webhooks.handlePullRequest,
      createPrArgs(ids, { action: "closed", merged: true }),
    );

    const links = await listTaskGitLinks(t, task);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ prState: "merged" });
  });
});

// --- processEvent（冪等マーキング + イベント反映の単一トランザクション、Issue #12） ---

/** processEvent へ渡す push イベント入力のファクトリ。 */
const createPushEvent = (
  ids: { repositoryId: Id<"repositories">; projectId: Id<"projects"> },
  overrides: Partial<{ commits: ReturnType<typeof createCommit>[] }> = {},
) => ({
  kind: "push" as const,
  ...ids,
  commits: [createCommit()],
  ...overrides,
});

describe("webhooks.processEvent", () => {
  it("新規 delivery はイベントを反映して processed を返し、delivery を記録する", async () => {
    const t = setup();
    const { project, task, repository } = await seedScenario(t);

    const result = await t.mutation(internal.webhooks.processEvent, {
      deliveryId: "d-1",
      event: createPushEvent({ repositoryId: repository, projectId: project }),
    });

    expect(result).toBe("processed");
    expect(await listTaskGitLinks(t, task)).toMatchObject([
      { type: "commit", externalRef: "abc123" },
    ]);
    expect(await listWebhookDeliveries(t)).toMatchObject([
      { deliveryId: "d-1" },
    ]);
  });

  it("同一 delivery の再送は duplicate を返し、イベント処理をスキップする", async () => {
    const t = setup();
    const { project, task, repository } = await seedScenario(t);
    const ids = { repositoryId: repository, projectId: project };
    await t.mutation(internal.webhooks.processEvent, {
      deliveryId: "d-1",
      event: createPushEvent(ids),
    });

    const result = await t.mutation(internal.webhooks.processEvent, {
      deliveryId: "d-1",
      event: createPushEvent(ids, {
        commits: [createCommit({ message: "[TASK-1] 別内容", sha: "def456" })],
      }),
    });

    expect(result).toBe("duplicate");
    // 反映されているのは初回の内容だけ
    expect(await listTaskGitLinks(t, task)).toMatchObject([
      { externalRef: "abc123" },
    ]);
  });

  it("deliveryId が空文字の場合は冪等マーカーを記録せず処理する（HTTP 層が 400 で拒否する前提の防御的分岐）", async () => {
    const t = setup();
    const { project, task, repository } = await seedScenario(t);

    const result = await t.mutation(internal.webhooks.processEvent, {
      deliveryId: "",
      event: createPushEvent({ repositoryId: repository, projectId: project }),
    });

    expect(result).toBe("processed");
    expect(await listTaskGitLinks(t, task)).toHaveLength(1);
    // 空文字を deliveryId として記録すると無関係な配信同士が重複扱いになるため記録しない
    expect(await listWebhookDeliveries(t)).toHaveLength(0);
  });

  it("イベント処理が失敗するとマーカーごとロールバックし、同一 delivery の再送で処理できる", async () => {
    const t = setup();
    const { project, task, repository } = await seedScenario(t);
    // 同一 (task, repository, type, externalRef) の GitLink を2件用意し、
    // upsertGitLink の .unique() を実際の経路で失敗させる（データ不整合の注入）
    await seedGitLink(
      t,
      { task, repository },
      {
        type: "commit",
        externalRef: "abc123",
        url: "https://old-1.example.com",
      },
    );
    const extra = await seedGitLink(
      t,
      { task, repository },
      {
        type: "commit",
        externalRef: "abc123",
        url: "https://old-2.example.com",
      },
    );
    const args = {
      deliveryId: "d-retry",
      event: createPushEvent({ repositoryId: repository, projectId: project }),
    };

    await expect(
      t.mutation(internal.webhooks.processEvent, args),
    ).rejects.toThrow();
    // 冪等マーカーは処理と同一トランザクションでロールバックされ、残らない
    expect(await listWebhookDeliveries(t)).toHaveLength(0);

    // 不整合を解消してから GitHub の再送（同一 delivery-id）を模すと、今度は処理される
    await t.run((ctx) => ctx.db.delete(extra));
    expect(await t.mutation(internal.webhooks.processEvent, args)).toBe(
      "processed",
    );
    const links = await listTaskGitLinks(t, task);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      externalRef: "abc123",
      url: "https://github.com/acme/repo/commit/abc123",
    });
    expect(await listWebhookDeliveries(t)).toMatchObject([
      { deliveryId: "d-retry" },
    ]);
  });
});
