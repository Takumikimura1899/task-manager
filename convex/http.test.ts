// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  TEST_REPO_REMOTE_URL,
  TEST_WEBHOOK_ENCRYPTION_KEY,
  TEST_WEBHOOK_SECRET,
  getTask,
  listTaskGitLinks,
  listWebhookDeliveries,
  seedGitLink,
  seedMember,
  seedProject,
  seedRepository,
  type T,
} from "../test/convexSupport";

/**
 * GitHub Webhook 受信エンドポイントの結合テスト（基本設計書 §7）。
 *
 * t.fetch で HTTP 境界ごと検証する: HMAC-SHA256 署名検証（復号した secret を使う
 * 経路を含む）・delivery-id による冪等化・イベント種別のディスパッチを、
 * HTTP レスポンスと DB の最終状態で固定する。各ハンドラ内部の分岐の網羅は
 * webhooks.test.ts に委ねる。
 *
 * 検証を通らないリクエスト（署名不正・未登録リポジトリ）はすべて同一の
 * 404 応答（ボディも同一）で拒否される。応答の違いから remoteUrl の登録状態を
 * 列挙できないことを固定する（Issue #18）。
 *
 * 冪等マーキングとイベント反映は単一トランザクション（webhooks.processEvent）で
 * 行われる（Issue #12）。処理失敗（500）時にマーカーが残らず、GitHub の再送で
 * 再処理される（at-least-once）ことも「重複配信」の describe で固定する。
 */

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const setup = () => convexTest(schema, modules);

// findRepositoryByUrls が webhookSecret を復号するため、本番同様に環境変数で鍵を注入する
beforeEach(() => {
  vi.stubEnv("WEBHOOK_ENCRYPTION_KEY", TEST_WEBHOOK_ENCRYPTION_KEY);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

// --- リクエスト組み立て -------------------------------------------------------

/** GitHub と同じ方式（HMAC-SHA256 の hex に sha256= を前置）で署名を計算する。 */
const sign = async (secret: string, body: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(new TextEncoder().encode(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new Uint8Array(new TextEncoder().encode(body)),
  );
  return `sha256=${Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
};

/**
 * Webhook リクエストを送る。署名は既定でリポジトリの secret による正しい値を計算し、
 * 異常系は signature / secret のオーバーライドで表現する。
 */
const postWebhook = async (
  t: T,
  args: {
    event: string;
    payload?: unknown;
    rawBody?: string;
    secret?: string;
    delivery?: string;
    signature?: string;
  },
) => {
  const body = args.rawBody ?? JSON.stringify(args.payload);
  const signature =
    args.signature ?? (await sign(args.secret ?? TEST_WEBHOOK_SECRET, body));
  return await t.fetch("/webhooks/github", {
    method: "POST",
    headers: {
      "x-github-event": args.event,
      "x-github-delivery": args.delivery ?? crypto.randomUUID(),
      "x-hub-signature-256": signature,
    },
    body,
  });
};

// --- ペイロードのファクトリ ---------------------------------------------------

const createCommit = (
  overrides: Partial<{ id: string; message: string; url: string }> = {},
) => ({
  id: "abc123",
  message: "[TASK-1] fix: バグ修正",
  url: `${TEST_REPO_REMOTE_URL}/commit/abc123`,
  ...overrides,
});

const createPushPayload = (
  overrides: Partial<{
    repository: { html_url: string };
    commits: ReturnType<typeof createCommit>[];
  }> = {},
) => ({
  repository: { html_url: TEST_REPO_REMOTE_URL },
  commits: [createCommit()],
  ...overrides,
});

const createBranchCreatePayload = (
  overrides: Partial<{
    repository: { html_url: string };
    ref: string;
    ref_type: string;
  }> = {},
) => ({
  repository: { html_url: TEST_REPO_REMOTE_URL },
  ref: "feature/TASK-1-login",
  ref_type: "branch",
  ...overrides,
});

const createPullRequestPayload = (
  pr: Partial<{
    merged: boolean;
    draft: boolean;
    number: number;
    html_url: string;
    title: string;
    body: string;
    head: { ref: string };
  }> = {},
  overrides: Partial<{ repository: { html_url: string }; action: string }> = {},
) => ({
  repository: { html_url: TEST_REPO_REMOTE_URL },
  action: "opened",
  ...overrides,
  pull_request: {
    merged: false,
    draft: false,
    number: 5,
    html_url: `${TEST_REPO_REMOTE_URL}/pull/5`,
    title: "TASK-1 ログイン修正",
    body: "",
    head: { ref: "feature/task" },
    ...pr,
  },
});

// --- シナリオ seed ------------------------------------------------------------

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
  const repository = await seedRepository(t, project);
  return { project, member, issue, task, repository };
};

/** Task を todo へ進める（branch_created / pr_opened の自動遷移が効く状態にする）。 */
const toTodo = (t: T, task: Id<"tasks">) =>
  t.mutation(api.tasks.transitionStatus, {
    id: task,
    to: "todo",
    expectedRevision: 0,
  });

// --- 署名検証 -----------------------------------------------------------------

describe("POST /webhooks/github の署名検証", () => {
  it("正しい署名の push を 200 で受理し、コミットの GitLink を反映する", async () => {
    const t = setup();
    const { task } = await seedScenario(t);

    const res = await postWebhook(t, {
      event: "push",
      payload: createPushPayload(),
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(await listTaskGitLinks(t, task)).toMatchObject([
      { type: "commit", externalRef: "abc123" },
    ]);
  });

  it.each([
    { name: "別の secret で署名した", override: { secret: "attacker-secret" } },
    {
      name: "署名が改ざんされた",
      override: { signature: `sha256=${"0".repeat(64)}` },
    },
    { name: "署名ヘッダがない", override: { signature: "" } },
    { name: "署名ヘッダの形式が不正な", override: { signature: "sha256=xyz" } },
  ])(
    "$name リクエストは 404 で拒否し、何も反映しない",
    async ({ override }) => {
      const t = setup();
      const { task } = await seedScenario(t);

      const res = await postWebhook(t, {
        event: "push",
        payload: createPushPayload(),
        ...override,
      });

      expect(res.status).toBe(404);
      expect(await res.text()).toBe("not found");
      expect(await listTaskGitLinks(t, task)).toHaveLength(0);
    },
  );

  it("未登録リポジトリからのリクエストは 404 を返し、何も反映しない", async () => {
    const t = setup();
    const { task } = await seedScenario(t);

    const res = await postWebhook(t, {
      event: "push",
      payload: createPushPayload({
        repository: { html_url: "https://github.com/acme/unknown" },
      }),
    });

    expect(res.status).toBe(404);
    expect(await res.text()).toBe("not found");
    expect(await listTaskGitLinks(t, task)).toHaveLength(0);
  });

  it("未登録リポジトリと署名不一致の応答は status・ボディともに同一で区別できない（Issue #18）", async () => {
    const t = setup();
    await seedScenario(t);

    // 未登録の remoteUrl へ、形式上正しい署名を付けて送る
    const unregistered = await postWebhook(t, {
      event: "push",
      payload: createPushPayload({
        repository: { html_url: "https://github.com/acme/unknown" },
      }),
    });
    // 登録済みの remoteUrl へ、誤った secret の署名を付けて送る
    const badSignature = await postWebhook(t, {
      event: "push",
      payload: createPushPayload(),
      secret: "attacker-secret",
    });

    expect(unregistered.status).toBe(badSignature.status);
    expect(await unregistered.text()).toBe(await badSignature.text());
  });

  it("JSON として解釈できないボディは 400 を返す", async () => {
    const t = setup();
    await seedScenario(t);

    const res = await postWebhook(t, { event: "push", rawBody: "not-json" });

    expect(res.status).toBe(400);
  });
});

// --- リポジトリ解決の失敗（サーバ構成不備、Issue #16） --------------------------

describe("POST /webhooks/github のリポジトリ解決失敗", () => {
  it.each([
    { name: "暗号鍵が未設定の", key: "" },
    {
      // 保存時と異なる鍵では AES-GCM のタグ検証で復号が例外を投げる
      name: "暗号鍵が保存時と異なり復号に失敗する",
      key: btoa("fedcba9876543210fedcba9876543210"),
    },
  ])("$name 場合は貫通させず 500 を返し、何も反映しない", async ({ key }) => {
    const t = setup();
    // seed は正しい鍵（beforeEach で注入済み）で行い、受信時だけ構成を壊す
    const { task } = await seedScenario(t);
    vi.stubEnv("WEBHOOK_ENCRYPTION_KEY", key);

    const res = await postWebhook(t, {
      event: "push",
      payload: createPushPayload(),
    });

    expect(res.status).toBe(500);
    expect(await listTaskGitLinks(t, task)).toHaveLength(0);
  });
});

// --- 冪等化（X-GitHub-Delivery） ------------------------------------------------

describe("POST /webhooks/github の重複配信", () => {
  // ヘッダ欠落（headers.get が null）はハンドラ側で "" に正規化されるため、
  // 空文字ヘッダの送信で「欠落」と同じ経路を検証できる。
  it("x-github-delivery の無いリクエストは冪等化できないため 400 で拒否し、何も反映しない（Issue #16）", async () => {
    const t = setup();
    const { task } = await seedScenario(t);

    const res = await postWebhook(t, {
      event: "push",
      payload: createPushPayload(),
      delivery: "",
    });

    expect(res.status).toBe(400);
    expect(await listTaskGitLinks(t, task)).toHaveLength(0);
    expect(await listWebhookDeliveries(t)).toHaveLength(0);
  });

  it("同一 delivery-id の再送は duplicate として 200 で無視する", async () => {
    const t = setup();
    const { task } = await seedScenario(t);
    const delivery = "delivery-1";

    const first = await postWebhook(t, {
      event: "push",
      payload: createPushPayload(),
      delivery,
    });
    expect(first.status).toBe(200);
    expect(await first.text()).toBe("ok");

    // 同じ delivery-id で内容の異なる正規リクエストを再送しても処理されない
    const second = await postWebhook(t, {
      event: "push",
      payload: createPushPayload({
        commits: [
          createCommit({
            id: "def456",
            url: `${TEST_REPO_REMOTE_URL}/commit/def456`,
          }),
        ],
      }),
      delivery,
    });
    expect(second.status).toBe(200);
    expect(await second.text()).toBe("duplicate");

    // 反映されているのは初回の内容だけ
    const links = await listTaskGitLinks(t, task);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ externalRef: "abc123" });
  });

  it("処理に失敗した配信は 500 を返し、マーカーが残らないため再送で処理される", async () => {
    const t = setup();
    const { task, repository } = await seedScenario(t);
    // 同一 (repository, type, externalRef) の GitLink を2件用意し、
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
    const delivery = "delivery-retry";

    const first = await postWebhook(t, {
      event: "push",
      payload: createPushPayload(),
      delivery,
    });
    expect(first.status).toBe(500);
    // 冪等マーカーは処理と同一トランザクションでロールバックされ、残らない
    expect(await listWebhookDeliveries(t)).toHaveLength(0);

    // 障害（データ不整合）を解消してから、GitHub の再送を模す
    // （同一 delivery-id・同一ペイロード）。duplicate 扱いにならず処理される
    await t.run((ctx) => ctx.db.delete(extra));
    const second = await postWebhook(t, {
      event: "push",
      payload: createPushPayload(),
      delivery,
    });
    expect(second.status).toBe(200);
    expect(await second.text()).toBe("ok");
    const links = await listTaskGitLinks(t, task);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      externalRef: "abc123",
      url: `${TEST_REPO_REMOTE_URL}/commit/abc123`,
    });
  });
});

// --- イベント種別ディスパッチ ---------------------------------------------------

describe("POST /webhooks/github のイベントディスパッチ", () => {
  it("create(branch) イベントでタスクが todo → in_progress に自動遷移する", async () => {
    const t = setup();
    const { task } = await seedScenario(t);
    await toTodo(t, task);

    const res = await postWebhook(t, {
      event: "create",
      payload: createBranchCreatePayload(),
    });

    expect(res.status).toBe(200);
    expect((await getTask(t, task))?.status).toBe("in_progress");
  });

  it("create イベントでも ref_type が branch 以外（tag）は無視する", async () => {
    const t = setup();
    const { task } = await seedScenario(t);
    await toTodo(t, task);

    const res = await postWebhook(t, {
      event: "create",
      payload: createBranchCreatePayload({ ref_type: "tag", ref: "TASK-1" }),
    });

    expect(res.status).toBe(200);
    expect((await getTask(t, task))?.status).toBe("todo");
  });

  it("pull_request イベントで GitLink(pull_request) と自動遷移を反映する", async () => {
    const t = setup();
    const { task } = await seedScenario(t);
    await toTodo(t, task);

    const res = await postWebhook(t, {
      event: "pull_request",
      payload: createPullRequestPayload(),
    });

    expect(res.status).toBe(200);
    expect(await listTaskGitLinks(t, task)).toMatchObject([
      { type: "pull_request", externalRef: "5", prState: "open" },
    ]);
    expect((await getTask(t, task))?.status).toBe("in_progress");
  });

  it("未対応イベント（issues 等）は 200 で受理し、何も反映しない", async () => {
    const t = setup();
    const { task } = await seedScenario(t);

    const res = await postWebhook(t, {
      event: "issues",
      payload: { repository: { html_url: TEST_REPO_REMOTE_URL } },
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(await listTaskGitLinks(t, task)).toHaveLength(0);
  });
});
