// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  TEST_WEBHOOK_ENCRYPTION_KEY,
  getTask,
  listTaskGitLinks,
  seedGitLink,
  seedMember,
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
 * 注意: ディスパッチ処理が失敗した場合の再送挙動（冪等マーカー先行コミット問題）は
 * Issue #12 の修正側でテストを追加する。ここでは成功経路のみを固定する。
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
 */
const seedScenario = async (t: T) => {
  const project = await seedProject(t);
  const member = await seedMember(t);
  const { issue, task } = await t.mutation(api.issues.create, {
    project,
    title: "課題",
    createdBy: member,
    firstTask: { title: "最初のタスク" },
  });
  const repository = await seedRepository(t, project);
  return { project, member, issue, task, repository };
};

/** 同じ Issue に Task を1件追加する（連番で TASK-2, TASK-3, … になる）。 */
const addTask = (
  t: T,
  issue: Id<"issues">,
  member: Id<"members">,
  title = "追加タスク",
) => t.mutation(api.tasks.create, { issue, title, createdBy: member });

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

// --- handleBranchCreated（findTask 照合 + branch_created 遷移） ---------------

describe("webhooks.handleBranchCreated", () => {
  it("ブランチ名の参照に一致するタスクを todo → in_progress に進める", async () => {
    const t = setup();
    const { project, task } = await seedScenario(t);
    await driveTo(t, task, "todo");

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
    const { project, task } = await seedScenario(t);
    await driveTo(t, task, "todo");

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
      const { project, task } = await seedScenario(t);
      await driveTo(t, task, from);
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
    const { project, member, issue, task } = await seedScenario(t);
    const second = await addTask(t, issue, member); // TASK-2
    await driveTo(t, second, "in_progress"); // 遷移先列に既存タスクを置いておく
    await driveTo(t, task, "todo");

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
    const { project, member, issue, task, repository } = await seedScenario(t);
    const second = await addTask(t, issue, member); // TASK-2

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

  it("1コミットに複数の参照があっても GitLink が付くのは最初の参照のタスクのみ（現行仕様）", async () => {
    // upsertGitLink は (repository, type, externalRef=sha) で同定するため、
    // 同一 sha の2つ目以降の参照は既存リンクへの patch になり、別タスクへは付かない。
    // 「1コミットで複数タスクへリンクしたい」なら同定キーの見直しが必要（要 Issue 化）。
    const t = setup();
    const { project, member, issue, task, repository } = await seedScenario(t);
    const second = await addTask(t, issue, member); // TASK-2

    await t.mutation(internal.webhooks.handlePush, {
      repositoryId: repository,
      projectId: project,
      commits: [createCommit({ message: "[TASK-1][TASK-2] refactor" })],
    });

    expect(await listTaskGitLinks(t, task)).toHaveLength(1);
    expect(await listTaskGitLinks(t, second)).toHaveLength(0);
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
    const { project, task, repository } = await seedScenario(t);
    await driveTo(t, task, from);

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
    const { project, member, issue, task, repository } = await seedScenario(t);
    const second = await addTask(t, issue, member); // TASK-2

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

// --- tryMarkDelivery（成功経路の冪等化。失敗時の再送挙動は Issue #12 側で扱う） ---

describe("webhooks.tryMarkDelivery", () => {
  it("新規 delivery-id には true、同一 id の再送には false を返す", async () => {
    const t = setup();

    expect(
      await t.mutation(internal.webhooks.tryMarkDelivery, {
        deliveryId: "d-1",
      }),
    ).toBe(true);
    expect(
      await t.mutation(internal.webhooks.tryMarkDelivery, {
        deliveryId: "d-1",
      }),
    ).toBe(false);
    // 異なる id は独立に受理される
    expect(
      await t.mutation(internal.webhooks.tryMarkDelivery, {
        deliveryId: "d-2",
      }),
    ).toBe(true);
  });
});
