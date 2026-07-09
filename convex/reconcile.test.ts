// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import {
  type MockInstance,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import type { GitHubCommit, GitHubPullRequest } from "./lib/githubReconcile";
import {
  TEST_WEBHOOK_ENCRYPTION_KEY,
  getTask,
  listTaskGitLinks,
  listWebhookDeliveries,
  seedMember,
  seedProject,
  seedRepository,
  type T,
} from "../test/convexSupport";

/**
 * Webhook reconcile の結合テスト（Issue #33 / 基本設計書リスク#5）。
 *
 * GitHub API（外部依存）は fetch のスタブで置き換え、reconcile 実行後の
 * 観測可能な結果（タスク状態・GitLink・冪等マーカー）で振る舞いを検証する。
 * GitHub レスポンス → イベントの変換規則は lib/githubReconcile.test.ts で
 * 単体検証済みで、ここでは「既存 Webhook 経路への流し込み・冪等性・
 * 1リポジトリ失敗時の継続」を固定する。
 */

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const setup = () => convexTest(schema, modules);

let errorSpy: MockInstance;

beforeEach(() => {
  vi.stubEnv("WEBHOOK_ENCRYPTION_KEY", TEST_WEBHOOK_ENCRYPTION_KEY);
  vi.stubEnv("GITHUB_TOKEN", "test-token");
  // 期待どおりのログ出力を検証しつつ、テスト出力を汚さない
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// --- GitHub API スタブ --------------------------------------------------------

type StubRepo = {
  pulls?: GitHubPullRequest[];
  commits?: GitHubCommit[];
  /** 指定すると全エンドポイントがこのステータスで失敗する（障害注入用）。 */
  status?: number;
};

/** owner/repo → レスポンス定義のマップで GitHub REST API を偽装する。 */
const stubGitHubApi = (repos: Record<string, StubRepo>) => {
  const fetchMock = vi.fn<(input: unknown) => Promise<Response>>(
    async (input) => {
      const url = String(input);
      const match = url.match(
        /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/(commits|pulls)\?/,
      );
      const entry = match === null ? undefined : repos[match[1]];
      if (match === null || entry === undefined) {
        return new Response("not found", { status: 404 });
      }
      if (entry.status !== undefined) {
        return new Response("error", { status: entry.status });
      }
      const data =
        match[2] === "commits" ? (entry.commits ?? []) : (entry.pulls ?? []);
      return new Response(JSON.stringify(data), { status: 200 });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

/** GitHub REST API の PR オブジェクトのファクトリ（既定はウィンドウ内に更新された open PR）。 */
const createGitHubPr = (
  overrides: Partial<GitHubPullRequest> = {},
): GitHubPullRequest => ({
  number: 5,
  state: "open",
  draft: false,
  merged_at: null,
  html_url: "https://github.com/acme/repo/pull/5",
  title: "TASK-1 ログイン修正",
  body: "",
  updated_at: new Date().toISOString(),
  head: { ref: "feature/TASK-1" },
  ...overrides,
});

/** マージ済みクローズの PR（pr_merged 相当）。 */
const createMergedPr = (overrides: Partial<GitHubPullRequest> = {}) =>
  createGitHubPr({
    state: "closed",
    merged_at: new Date().toISOString(),
    ...overrides,
  });

/** GitHub REST API の commit オブジェクトのファクトリ。 */
const createGitHubCommit = (
  overrides: Partial<GitHubCommit> = {},
): GitHubCommit => ({
  sha: "abc123",
  html_url: "https://github.com/acme/repo/commit/abc123",
  commit: { message: "[TASK-1] fix: バグ修正" },
  ...overrides,
});

// --- シナリオ ----------------------------------------------------------------

/** key=TASK のプロジェクトに Issue と TASK-1（backlog）、連携先リポジトリを用意する。 */
const seedScenario = async (t: T) => {
  const project = await seedProject(t);
  const member = await seedMember(t);
  const { issue, task } = await t.mutation(api.issues.create, {
    project,
    title: "課題",
    createdBy: member,
    firstTask: { title: "最初のタスク" },
  });
  const repository = await seedRepository(t, project); // acme/repo
  return { project, member, issue, task, repository };
};

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

/** Task を取得し、存在（非 null）を表明してから素のドキュメントを返す。 */
const loadTask = async (t: T, id: Id<"tasks">) => {
  const task = await getTask(t, id);
  expect(task).not.toBeNull();
  return task!;
};

// --- 取りこぼしの補正（既存 Webhook 経路への流し込み） -------------------------

describe("reconcile.run — 取りこぼしイベントの補正", () => {
  it("取りこぼした merged PR を補正する（in_review → done + GitLink 記録 + 冪等マーカー）", async () => {
    const t = setup();
    const { task, repository } = await seedScenario(t);
    await driveTo(t, task, "in_review");
    stubGitHubApi({ "acme/repo": { pulls: [createMergedPr()] } });

    await t.action(internal.reconcile.run, {});

    expect((await loadTask(t, task)).status).toBe("done");
    expect(await listTaskGitLinks(t, task)).toMatchObject([
      { repository, type: "pull_request", externalRef: "5", prState: "merged" },
    ]);
    // reconcile 独自の deliveryId 形式で冪等マーカーが残る
    const deliveries = await listWebhookDeliveries(t);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].deliveryId).toMatch(/^reconcile:.+:pr:5:/);
  });

  it("取りこぼした open PR を補正する（todo → in_progress）", async () => {
    const t = setup();
    const { task } = await seedScenario(t);
    await driveTo(t, task, "todo");
    stubGitHubApi({ "acme/repo": { pulls: [createGitHubPr()] } });

    await t.action(internal.reconcile.run, {});

    expect((await loadTask(t, task)).status).toBe("in_progress");
    expect(await listTaskGitLinks(t, task)).toMatchObject([
      { type: "pull_request", prState: "open" },
    ]);
  });

  it("取りこぼした push コミットに GitLink(commit) を追加する（遷移はしない）", async () => {
    const t = setup();
    const { task } = await seedScenario(t);
    stubGitHubApi({ "acme/repo": { commits: [createGitHubCommit()] } });

    await t.action(internal.reconcile.run, {});

    expect(await listTaskGitLinks(t, task)).toMatchObject([
      { type: "commit", externalRef: "abc123" },
    ]);
    expect((await loadTask(t, task)).status).toBe("backlog");
  });

  it("ウィンドウ外（lookback より古い更新）の PR は補正対象にしない", async () => {
    const t = setup();
    const { task } = await seedScenario(t);
    await driveTo(t, task, "in_review");
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    stubGitHubApi({
      "acme/repo": { pulls: [createMergedPr({ updated_at: twoHoursAgo })] },
    });

    await t.action(internal.reconcile.run, {});

    expect((await loadTask(t, task)).status).toBe("in_review");
    expect(await listTaskGitLinks(t, task)).toHaveLength(0);
    expect(await listWebhookDeliveries(t)).toHaveLength(0);
  });
});

// --- 冪等性 -------------------------------------------------------------------

describe("reconcile.run — 冪等性", () => {
  it("Webhook で処理済みのイベントを二重適用しない（状態・revision・GitLink が不変）", async () => {
    const t = setup();
    const { project, task, repository } = await seedScenario(t);
    await driveTo(t, task, "in_review");
    // Webhook 経路（GitHub の delivery UUID）で merged イベントを処理済みにする
    await t.mutation(internal.webhooks.processEvent, {
      deliveryId: "gh-delivery-uuid-1",
      event: {
        kind: "pull_request" as const,
        repositoryId: repository,
        projectId: project,
        action: "closed",
        merged: true,
        draft: false,
        number: 5,
        url: "https://github.com/acme/repo/pull/5",
        title: "TASK-1 ログイン修正",
        body: "",
        branch: "feature/TASK-1",
      },
    });
    const processed = await loadTask(t, task);
    expect(processed.status).toBe("done");
    stubGitHubApi({ "acme/repo": { pulls: [createMergedPr()] } });

    await t.action(internal.reconcile.run, {});

    const after = await loadTask(t, task);
    expect(after.status).toBe("done");
    expect(after.revision).toBe(processed.revision); // 二重適用で revision が進まない
    expect(await listTaskGitLinks(t, task)).toHaveLength(1);
  });

  it("同一スナップショットの再実行は冪等マーカーでスキップされる", async () => {
    const t = setup();
    const { task } = await seedScenario(t);
    await driveTo(t, task, "in_review");
    stubGitHubApi({
      "acme/repo": {
        pulls: [createMergedPr()],
        commits: [createGitHubCommit()],
      },
    });
    await t.action(internal.reconcile.run, {});
    const firstRun = await loadTask(t, task);
    const firstDeliveries = await listWebhookDeliveries(t);

    await t.action(internal.reconcile.run, {});

    const after = await loadTask(t, task);
    expect(after.revision).toBe(firstRun.revision);
    expect(await listWebhookDeliveries(t)).toHaveLength(firstDeliveries.length);
    expect(await listTaskGitLinks(t, task)).toHaveLength(2); // PR + commit の各1件のみ
  });
});

// --- 失敗の分離とサイレント失敗の回避 -------------------------------------------

describe("reconcile.run — エラー処理", () => {
  it("1リポジトリの失敗は他リポジトリの補正を止めず、エラーとして伝播する", async () => {
    const t = setup();
    const project = await seedProject(t);
    const member = await seedMember(t);
    const { task } = await t.mutation(api.issues.create, {
      project,
      title: "課題",
      createdBy: member,
      firstTask: { title: "最初のタスク" },
    });
    // 失敗するリポジトリを先に登録し、後続の補正が継続されることを確かめる
    await seedRepository(t, project, {
      remoteUrl: "https://github.com/acme/bad",
    });
    await seedRepository(t, project); // acme/repo
    await driveTo(t, task, "in_review");
    stubGitHubApi({
      "acme/bad": { status: 500 },
      "acme/repo": { pulls: [createMergedPr()] },
    });

    await expect(t.action(internal.reconcile.run, {})).rejects.toThrow(
      /1\/2 件のリポジトリで補正に失敗/,
    );

    // 失敗リポジトリの後ろにあるリポジトリも補正されている
    expect((await loadTask(t, task)).status).toBe("done");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("acme/bad"),
      expect.anything(),
    );
  });

  it("GITHUB_TOKEN 未設定時は GitHub API を呼ばずスキップし、ログに残す", async () => {
    const t = setup();
    await seedScenario(t);
    vi.stubEnv("GITHUB_TOKEN", "");
    const fetchMock = stubGitHubApi({});

    await t.action(internal.reconcile.run, {});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("GITHUB_TOKEN"),
    );
  });

  it("GitHub 形式でない remoteUrl はログを残してスキップする（実行全体は失敗しない）", async () => {
    const t = setup();
    const project = await seedProject(t);
    await seedRepository(t, project, {
      remoteUrl: "https://gitlab.com/acme/repo",
    });
    const fetchMock = stubGitHubApi({});

    await t.action(internal.reconcile.run, {});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("https://gitlab.com/acme/repo"),
    );
  });
});
