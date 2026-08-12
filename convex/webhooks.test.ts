// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type As,
  TEST_WEBHOOK_ENCRYPTION_KEY,
  getTask,
  listTaskGitLinks,
  listWebhookDeliveries,
  seedGitLink,
  seedTaskWithRepository,
  setup,
  type T,
} from "../test/convexSupport";

/**
 * Webhook イベント処理の結合テスト（基本設計書 §5 自動遷移 / §7）。
 *
 * HTTP 層（署名検証・ヘッダ解析）は http.test.ts で検証し、ここでは
 * processEvent（webhooks.ts）を呼び出して「Git イベントが DB の最終状態に
 * どう反映されるか」を固定する（古典学派・結合テスト層）。processEvent は
 * 冪等マーキングとイベント種別ごとのディスパッチを単一トランザクションで
 * 行うため、ここでの呼び出しは本番と同じ経路をそのまま通る。
 * イベント種別ごとの分岐（branch_created / push / pull_request）を単体で
 * 検証するテストは deliveryId: "" を渡し、冪等化を経路から外す（webhooks.ts の
 * markDeliveryIfNew は空文字を「マーカーを残さず常に処理する」防御的分岐として
 * 許容している）。
 * 参照抽出（gitRef）・遷移表（gitAutomation）の純粋関数は lib/*.test.ts で
 * 単体検証済みで、ここでは結線と DB 反映を検証する。
 *
 * 冪等マーキングとイベント反映が同一トランザクションで行われること
 * （処理失敗時にマーカーが残らず再送で再処理できること）は
 * webhooks.processEvent（冪等マーキング）の describe を参照。
 */

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

// key=TASK のプロジェクトに Issue と TASK-1（backlog）、連携先リポジトリを用意する
// seedTaskWithRepository（test/convexSupport.ts に一元化）を使う。internal
// ミューテーション（processEvent 等）自体は無認証のままでよい。

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

/** processEvent へ渡す branch_created イベント入力のファクトリ。 */
const createBranchCreatedEvent = (
  projectId: Id<"projects">,
  overrides: Partial<{ branchName: string }> = {},
) => ({
  kind: "branch_created" as const,
  projectId,
  branchName: "TASK-1-fix",
  ...overrides,
});

// --- branch_created（findTask 照合 + 遷移） -----------------------------------

describe("webhooks.processEvent（branch_created）", () => {
  it("ブランチ名の参照に一致するタスクを todo → in_progress に進める", async () => {
    const t = setup();
    const { as, project, task } = await seedTaskWithRepository(t);
    await driveTo(as, task, "todo");

    await t.mutation(internal.webhooks.processEvent, {
      deliveryId: "",
      event: createBranchCreatedEvent(project, {
        branchName: "feature/TASK-1-login",
      }),
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
    const { as, project, task } = await seedTaskWithRepository(t);
    await driveTo(as, task, "todo");

    await t.mutation(internal.webhooks.processEvent, {
      deliveryId: "",
      event: createBranchCreatedEvent(project, { branchName }),
    });

    const after = await loadTask(t, task);
    expect(after.status).toBe("todo");
    expect(after.revision).toBe(1); // 自動遷移が走っていない
  });
});

// --- 自動遷移の共通規則（applyTransition: 前進のみ + 末尾 rank） --------------

describe("Git イベントによる自動遷移（applyTransition）", () => {
  it.each([
    { name: "in_review", target: "in_review" as const },
    { name: "done（終端）", target: "done" as const },
  ])(
    "branch_created は既に進んだ（$name）タスクを上書きしない（前進のみ。他の前進しすぎ・手動操作の尊重パターンは gitAutomation.test.ts の「適用されない」describe が保証。in_progress 始点は gitAutomation.test.ts が被覆済み）",
    async ({ target }) => {
      const t = setup();
      const { as, project, task } = await seedTaskWithRepository(t);
      await driveTo(as, task, target);
      const before = await loadTask(t, task);

      await t.mutation(internal.webhooks.processEvent, {
        deliveryId: "",
        event: createBranchCreatedEvent(project),
      });

      const after = await loadTask(t, task);
      expect(after.status).toBe(target);
      expect(after.revision).toBe(before.revision);
    },
  );

  it("backlog からの branch_created は隣接遷移でないため適用しない（スキップ前進禁止）", async () => {
    const t = setup();
    const { project, task } = await seedTaskWithRepository(t);

    await t.mutation(internal.webhooks.processEvent, {
      deliveryId: "",
      event: createBranchCreatedEvent(project),
    });

    expect((await loadTask(t, task)).status).toBe("backlog");
  });

  it("自動遷移したタスクは遷移先列の末尾 rank に置かれる", async () => {
    const t = setup();
    const { as, project, issue, task } = await seedTaskWithRepository(t);
    const second = await addTask(as, issue); // TASK-2
    await driveTo(as, second, "in_progress"); // 遷移先列に既存タスクを置いておく
    await driveTo(as, task, "todo");

    await t.mutation(internal.webhooks.processEvent, {
      deliveryId: "",
      event: createBranchCreatedEvent(project),
    });

    const moved = await loadTask(t, task);
    const existing = await loadTask(t, second);
    expect(moved.status).toBe("in_progress");
    expect(moved.rank > existing.rank).toBe(true); // 既存タスクの後ろ（列末尾）
  });
});

// --- push（commit メッセージの [KEY-番号] → GitLink） -------------------------

/** push イベントの commits へ渡す commit 1件分のファクトリ。 */
const createCommit = (
  overrides: Partial<{ message: string; sha: string; url: string }> = {},
) => ({
  message: "[TASK-1] fix: バグ修正",
  sha: "abc123",
  url: "https://github.com/acme/repo/commit/abc123",
  ...overrides,
});

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

describe("webhooks.processEvent（push）", () => {
  it("[KEY-番号] を含むコミットに GitLink(commit) を追加する（ステータス遷移はしない）", async () => {
    const t = setup();
    const { project, task, repository } = await seedTaskWithRepository(t);

    await t.mutation(internal.webhooks.processEvent, {
      deliveryId: "",
      event: createPushEvent({ repositoryId: repository, projectId: project }),
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
    const { as, project, issue, task, repository } =
      await seedTaskWithRepository(t);
    const second = await addTask(as, issue); // TASK-2

    await t.mutation(internal.webhooks.processEvent, {
      deliveryId: "",
      event: createPushEvent(
        { repositoryId: repository, projectId: project },
        {
          commits: [
            createCommit({ message: "[TASK-1] fix" }),
            createCommit({ message: "[TASK-2] refactor", sha: "def456" }),
          ],
        },
      ),
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
    const { as, project, issue, task, repository } =
      await seedTaskWithRepository(t);
    const second = await addTask(as, issue); // TASK-2

    await t.mutation(internal.webhooks.processEvent, {
      deliveryId: "",
      event: createPushEvent(
        { repositoryId: repository, projectId: project },
        { commits: [createCommit({ message: "[TASK-1][TASK-2] refactor" })] },
      ),
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
    const { as, project, issue, task, repository } =
      await seedTaskWithRepository(t);
    const second = await addTask(as, issue); // TASK-2
    const event = createPushEvent(
      { repositoryId: repository, projectId: project },
      { commits: [createCommit({ message: "[TASK-1][TASK-2] refactor" })] },
    );

    await t.mutation(internal.webhooks.processEvent, {
      deliveryId: "",
      event,
    });
    await t.mutation(internal.webhooks.processEvent, {
      deliveryId: "",
      event,
    });

    expect(await listTaskGitLinks(t, task)).toHaveLength(1);
    expect(await listTaskGitLinks(t, second)).toHaveLength(1);
  });

  it("未知のタスク番号を含むコミットは無視する（参照抽出そのものの失敗パターンは gitRef.test.ts が保証）", async () => {
    const t = setup();
    const { project, task, repository } = await seedTaskWithRepository(t);

    await t.mutation(internal.webhooks.processEvent, {
      deliveryId: "",
      event: createPushEvent(
        { repositoryId: repository, projectId: project },
        { commits: [createCommit({ message: "[TASK-999] 修正" })] },
      ),
    });

    expect(await listTaskGitLinks(t, task)).toHaveLength(0);
  });

  it("同じ sha の再送は GitLink を増やさず URL を更新する（upsert）", async () => {
    const t = setup();
    const { project, task, repository } = await seedTaskWithRepository(t);
    await seedGitLink(
      t,
      { task, repository },
      { type: "commit", externalRef: "abc123", url: "https://old.example.com" },
    );

    await t.mutation(internal.webhooks.processEvent, {
      deliveryId: "",
      event: createPushEvent({ repositoryId: repository, projectId: project }),
    });

    const links = await listTaskGitLinks(t, task);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      externalRef: "abc123",
      url: "https://github.com/acme/repo/commit/abc123",
    });
  });
});

// --- pull_request（GitLink upsert + PR state / action ごとの遷移） -----------

/** pull_request イベントの本体引数のファクトリ（既定はタイトルに TASK-1 参照を持つ opened）。 */
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

/** processEvent へ渡す pull_request イベント入力のファクトリ。 */
const createPullRequestEvent = (
  ids: { repositoryId: Id<"repositories">; projectId: Id<"projects"> },
  overrides: Parameters<typeof createPrArgs>[1] = {},
) => ({ kind: "pull_request" as const, ...createPrArgs(ids, overrides) });

describe("webhooks.processEvent（pull_request）", () => {
  // prState マッピングと action ごとの遷移は元々それぞれ it.each で網羅していたが、
  // webhooks.ts の分岐自体は単純な三項演算子の連鎖であり、GitLink 反映と状態遷移を
  // 同時に固定する代表3件（型変更・no-op・終端 done）に縮小する。
  // action 文字列 → GitEventKind の写像（processPullRequest の else-if 連鎖）自体は、
  // 上記3件（opened/synchronize/closed+merged）に加えて下記3件
  // （reopened/ready_for_review/closed+unmerged）で全分岐を1回ずつ踏む。
  it("opened（draft）で GitLink(pull_request) を prState=draft で記録し、todo → in_progress に進める", async () => {
    const t = setup();
    const { as, project, task, repository } = await seedTaskWithRepository(t);
    await driveTo(as, task, "todo");

    await t.mutation(internal.webhooks.processEvent, {
      deliveryId: "",
      event: createPullRequestEvent(
        { repositoryId: repository, projectId: project },
        { action: "opened", draft: true, merged: false },
      ),
    });

    expect((await loadTask(t, task)).status).toBe("in_progress");
    expect(await listTaskGitLinks(t, task)).toMatchObject([
      { type: "pull_request", externalRef: "5", prState: "draft" },
    ]);
  });

  it("synchronize は GitLink(pull_request) を更新するが、ステータスは変えない", async () => {
    const t = setup();
    const { as, project, task, repository } = await seedTaskWithRepository(t);
    await driveTo(as, task, "in_progress");

    await t.mutation(internal.webhooks.processEvent, {
      deliveryId: "",
      event: createPullRequestEvent(
        { repositoryId: repository, projectId: project },
        { action: "synchronize", draft: false, merged: false },
      ),
    });

    expect((await loadTask(t, task)).status).toBe("in_progress");
    expect(await listTaskGitLinks(t, task)).toMatchObject([
      { type: "pull_request", externalRef: "5", prState: "open" },
    ]);
  });

  it("closed（マージ済み）で GitLink(pull_request) を prState=merged とし、in_review → done に進める", async () => {
    const t = setup();
    const { as, project, task, repository } = await seedTaskWithRepository(t);
    await driveTo(as, task, "in_review");

    await t.mutation(internal.webhooks.processEvent, {
      deliveryId: "",
      event: createPullRequestEvent(
        { repositoryId: repository, projectId: project },
        { action: "closed", draft: false, merged: true },
      ),
    });

    expect((await loadTask(t, task)).status).toBe("done");
    expect(await listTaskGitLinks(t, task)).toMatchObject([
      { type: "pull_request", externalRef: "5", prState: "merged" },
    ]);
  });

  it("reopened は pr_opened として扱われ、todo → in_progress に進める（action→kind 写像）", async () => {
    const t = setup();
    const { as, project, task, repository } = await seedTaskWithRepository(t);
    await driveTo(as, task, "todo");

    await t.mutation(internal.webhooks.processEvent, {
      deliveryId: "",
      event: createPullRequestEvent(
        { repositoryId: repository, projectId: project },
        { action: "reopened", draft: false, merged: false },
      ),
    });

    expect((await loadTask(t, task)).status).toBe("in_progress");
  });

  it("ready_for_review は pr_ready として扱われ、in_progress → in_review に進める（action→kind 写像）", async () => {
    const t = setup();
    const { as, project, task, repository } = await seedTaskWithRepository(t);
    await driveTo(as, task, "in_progress");

    await t.mutation(internal.webhooks.processEvent, {
      deliveryId: "",
      event: createPullRequestEvent(
        { repositoryId: repository, projectId: project },
        { action: "ready_for_review", draft: false, merged: false },
      ),
    });

    expect((await loadTask(t, task)).status).toBe("in_review");
  });

  it("closed（未マージ）は pr_closed として扱われ、in_review → in_progress に差し戻す（action→kind 写像）", async () => {
    // in_review 始点なら pr_merged（→ done）と結果が分かれるため、
    // merged: false が pr_closed に写像されることを一意に固定できる
    const t = setup();
    const { as, project, task, repository } = await seedTaskWithRepository(t);
    await driveTo(as, task, "in_review");

    await t.mutation(internal.webhooks.processEvent, {
      deliveryId: "",
      event: createPullRequestEvent(
        { repositoryId: repository, projectId: project },
        { action: "closed", draft: false, merged: false },
      ),
    });

    expect((await loadTask(t, task)).status).toBe("in_progress");
    expect(await listTaskGitLinks(t, task)).toMatchObject([
      { type: "pull_request", externalRef: "5", prState: "closed" },
    ]);
  });

  it("参照はタイトルを最優先で解決する（本文の参照より優先）", async () => {
    const t = setup();
    const { as, project, issue, task, repository } =
      await seedTaskWithRepository(t);
    const second = await addTask(as, issue); // TASK-2

    await t.mutation(internal.webhooks.processEvent, {
      deliveryId: "",
      event: createPullRequestEvent(
        { repositoryId: repository, projectId: project },
        { title: "TASK-2 対応", body: "TASK-1 も関連" },
      ),
    });

    expect(await listTaskGitLinks(t, second)).toHaveLength(1);
    expect(await listTaskGitLinks(t, task)).toHaveLength(0);
  });

  it("タイトル・本文に参照がなければブランチ名から解決する（優先順位の各段の抽出結果は gitRef.test.ts が保証）", async () => {
    const t = setup();
    const { project, task, repository } = await seedTaskWithRepository(t);

    await t.mutation(internal.webhooks.processEvent, {
      deliveryId: "",
      event: createPullRequestEvent(
        { repositoryId: repository, projectId: project },
        {
          title: "リファクタリング",
          body: "説明なし",
          branch: "feature/TASK-1-refactor",
        },
      ),
    });

    expect(await listTaskGitLinks(t, task)).toHaveLength(1);
  });

  it("どこにもタスク参照のない PR は無視する", async () => {
    const t = setup();
    const { project, task, repository } = await seedTaskWithRepository(t);

    await t.mutation(internal.webhooks.processEvent, {
      deliveryId: "",
      event: createPullRequestEvent(
        { repositoryId: repository, projectId: project },
        { title: "リファクタリング", body: "", branch: "feature/refactor" },
      ),
    });

    expect(await listTaskGitLinks(t, task)).toHaveLength(0);
  });

  it("同じ PR 番号の再送は GitLink を増やさず prState を更新する（upsert）", async () => {
    const t = setup();
    const { project, task, repository } = await seedTaskWithRepository(t);
    const ids = { repositoryId: repository, projectId: project };

    await t.mutation(internal.webhooks.processEvent, {
      deliveryId: "",
      event: createPullRequestEvent(ids), // opened
    });
    await t.mutation(internal.webhooks.processEvent, {
      deliveryId: "",
      event: createPullRequestEvent(ids, { action: "closed", merged: true }),
    });

    const links = await listTaskGitLinks(t, task);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ prState: "merged" });
  });
});

// --- processEvent（冪等マーキング + イベント反映の単一トランザクション、Issue #12） ---

describe("webhooks.processEvent（冪等マーキング）", () => {
  it("新規 delivery はイベントを反映して processed を返し、delivery を記録する", async () => {
    const t = setup();
    const { project, task, repository } = await seedTaskWithRepository(t);

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
    const { project, task, repository } = await seedTaskWithRepository(t);
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
    const { project, task, repository } = await seedTaskWithRepository(t);

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
    const { project, task, repository } = await seedTaskWithRepository(t);
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
