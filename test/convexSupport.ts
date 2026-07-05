import type { TestConvex } from "convex-test";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { encryptSecret } from "../convex/lib/crypto";
import schema from "../convex/schema";

/**
 * Convex 結合テスト（convex-test）の共有セットアップ・ファクトリ。
 *
 * convex/ の外に置くのは意図的:
 * - convex/ 配下の非 test ファイルは `convex dev`/`deploy` のバンドル対象になり、
 *   ここが `convex-test` 等を参照すると本番デプロイを壊す（convex/tsconfig の
 *   include は全ファイル（./ 配下を再帰）で、test ファイルのみ CLI が除外する）。
 * - このファイルは convex-test を「型としてのみ」参照し（実体 import は各 test の
 *   setup 側）、convex のスキャン範囲外に置くことで巻き込みを完全に回避する。
 * - vitest の収集対象（*.test/*.spec）にも該当しないため単独実行もされない。
 *
 * schema 由来のファクトリ（seedProject / seedMember）を一元化し、スキーマ変更時の
 * 二重修正・ドリフトを防ぐ。
 */

export type T = TestConvex<typeof schema>;

/** projects を1件 seed する。採番カウンタは既定で 1 から。 */
export const seedProject = (
  t: T,
  overrides: Partial<{
    key: string;
    name: string;
    nextTaskNumber: number;
    nextIssueNumber: number;
  }> = {},
) =>
  t.run((ctx) =>
    ctx.db.insert("projects", {
      key: "TASK",
      name: "Test Project",
      nextTaskNumber: 1,
      nextIssueNumber: 1,
      ...overrides,
    }),
  );

/** members を1件 seed する。複数作る場合は email をオーバーライドして衝突を避ける。 */
export const seedMember = (
  t: T,
  overrides: Partial<{
    name: string;
    email: string;
    role: "admin" | "member";
  }> = {},
) =>
  t.run((ctx) =>
    ctx.db.insert("members", {
      name: "Alice",
      email: "alice@example.com",
      role: "member",
      ...overrides,
    }),
  );

/**
 * 「実体のないメンバー参照」を作る：seed 直後に delete し、Id だけを残す。
 * 参照整合性（存在しないメンバーの拒否）テスト用のゴースト生成ヘルパー。
 * email は既定の seedMember と衝突しない値にしてあるため、通常メンバーと併用できる。
 */
export const seedGhostMember = async (
  t: T,
  overrides: Parameters<typeof seedMember>[1] = {},
) => {
  const id = await seedMember(t, {
    name: "Ghost",
    email: "ghost@example.com",
    ...overrides,
  });
  await t.run((ctx) => ctx.db.delete(id));
  return id;
};

/** id から素の Task ドキュメントを取得する（最終状態の検証用）。 */
export const getTask = (t: T, id: Id<"tasks">) =>
  t.run((ctx) => ctx.db.get(id));

// --- Git 連携（repositories / gitLinks, §7） ---------------------------------

/**
 * テスト用の WEBHOOK_ENCRYPTION_KEY（base64 エンコードされた32バイトの固定値）。
 * repositories.ts / webhooks.ts は process.env から鍵を読むため、
 * seedRepository を使うテストでは `vi.stubEnv("WEBHOOK_ENCRYPTION_KEY", ...)` で注入する。
 */
export const TEST_WEBHOOK_ENCRYPTION_KEY = btoa(
  "0123456789abcdef0123456789abcdef",
);

/** seedRepository が既定で使う平文の webhookSecret（HMAC 署名の計算にも使う）。 */
export const TEST_WEBHOOK_SECRET = "test-webhook-secret";

/** seedRepository が既定で使う remoteUrl（webhook ペイロードの repository URL と揃える）。 */
export const TEST_REPO_REMOTE_URL = "https://github.com/acme/repo";

/**
 * repositories を1件 seed する。webhookSecret は本番経路と同じく AES-256-GCM で
 * 暗号化して保存する（署名検証が復号込みで通ることを検証できるようにするため）。
 * 事前に WEBHOOK_ENCRYPTION_KEY（TEST_WEBHOOK_ENCRYPTION_KEY）の注入が必要。
 */
export const seedRepository = async (
  t: T,
  project: Id<"projects">,
  overrides: Partial<{ remoteUrl: string; webhookSecret: string }> = {},
) => {
  const key = process.env.WEBHOOK_ENCRYPTION_KEY;
  if (key === undefined || key === "") {
    throw new Error(
      "seedRepository には WEBHOOK_ENCRYPTION_KEY が必要です（vi.stubEnv 等で注入してください）",
    );
  }
  const {
    remoteUrl = TEST_REPO_REMOTE_URL,
    webhookSecret = TEST_WEBHOOK_SECRET,
  } = overrides;
  const encrypted = await encryptSecret(webhookSecret, key);
  return await t.run((ctx) =>
    ctx.db.insert("repositories", {
      project,
      provider: "github",
      remoteUrl,
      webhookSecret: encrypted,
    }),
  );
};

/** gitLinks を1件 seed する（upsert 検証などで既存リンクを用意する用途）。 */
export const seedGitLink = (
  t: T,
  refs: { task: Id<"tasks">; repository: Id<"repositories"> },
  overrides: Partial<
    Pick<Doc<"gitLinks">, "type" | "externalRef" | "url" | "prState">
  > = {},
) =>
  t.run((ctx) =>
    ctx.db.insert("gitLinks", {
      ...refs,
      type: "branch",
      externalRef: "feature/TASK-1",
      url: `${TEST_REPO_REMOTE_URL}/tree/feature/TASK-1`,
      ...overrides,
    }),
  );

/** Task に紐づく GitLink 一覧を取得する（最終状態の検証用）。 */
export const listTaskGitLinks = (t: T, task: Id<"tasks">) =>
  t.run((ctx) =>
    ctx.db
      .query("gitLinks")
      .withIndex("by_task", (q) => q.eq("task", task))
      .collect(),
  );

/** webhookDeliveries の全件を取得する（冪等マーカーの最終状態の検証用）。 */
export const listWebhookDeliveries = (t: T) =>
  t.run((ctx) => ctx.db.query("webhookDeliveries").collect());
