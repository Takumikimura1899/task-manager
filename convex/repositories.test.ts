// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { decryptSecret } from "./lib/crypto";
import {
  TEST_WEBHOOK_ENCRYPTION_KEY,
  seedProject,
  seedRepository,
  type T,
} from "../test/convexSupport";

/**
 * Repository Core API の結合テスト（基本設計書 §3 / §7 / Issue #22）。
 *
 * 暗号化プリミティブ（encryptSecret / decryptSecret）は lib/crypto.test.ts で
 * 単体検証済み。ここではセキュリティ上重要な2点の結線を検証する:
 * - webhookSecret が平文のまま保存されないこと（AES-256-GCM・復号で往復可能）
 * - クエリが secret をクライアントへ返さないこと
 */

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const setup = () => convexTest(schema, modules);

// 本番経路と同じく環境変数で鍵を注入する（webhooks.test.ts と同様）
beforeEach(() => {
  vi.stubEnv("WEBHOOK_ENCRYPTION_KEY", TEST_WEBHOOK_ENCRYPTION_KEY);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const listRepositories = (t: T) =>
  t.run((ctx) => ctx.db.query("repositories").collect());

describe("repositories.create", () => {
  it("webhookSecret を暗号化して保存する（平文は残らず、鍵で復号すると元に戻る）", async () => {
    const t = setup();
    const project = await seedProject(t);
    const plaintext = "ghs_supersecret_webhook_token";

    const id = await t.mutation(api.repositories.create, {
      project,
      remoteUrl: "https://github.com/acme/repo",
      webhookSecret: plaintext,
    });

    const doc = await t.run((ctx) => ctx.db.get(id));
    expect(doc).toMatchObject({
      project,
      provider: "github",
      remoteUrl: "https://github.com/acme/repo",
    });
    // 保存値は平文そのものでも平文を含む形でもない
    expect(doc!.webhookSecret).not.toBe(plaintext);
    expect(doc!.webhookSecret).not.toContain(plaintext);
    // 可逆暗号（AES-256-GCM）なので鍵があれば元の平文に復号できる（署名検証で必要）
    expect(
      await decryptSecret(doc!.webhookSecret, TEST_WEBHOOK_ENCRYPTION_KEY),
    ).toBe(plaintext);
  });

  it("存在しないプロジェクトを指定すると拒否する（参照整合性）", async () => {
    const t = setup();
    const project = await seedProject(t);
    await t.run((ctx) => ctx.db.delete(project));

    await expect(
      t.mutation(api.repositories.create, {
        project,
        remoteUrl: "https://github.com/acme/repo",
        webhookSecret: "s",
      }),
    ).rejects.toThrowError("指定されたプロジェクトが存在しません");
  });

  it.each([
    { name: "未設定（undefined）", value: undefined },
    { name: "空文字", value: "" },
  ])(
    "WEBHOOK_ENCRYPTION_KEY が $name の場合はエラーになり、保存しない",
    async ({ value }) => {
      const t = setup();
      const project = await seedProject(t);
      vi.stubEnv("WEBHOOK_ENCRYPTION_KEY", value);

      await expect(
        t.mutation(api.repositories.create, {
          project,
          remoteUrl: "https://github.com/acme/repo",
          webhookSecret: "s",
        }),
      ).rejects.toThrowError("WEBHOOK_ENCRYPTION_KEY が設定されていません");

      // 平文はもちろん、中途半端なレコードも残らない
      expect(await listRepositories(t)).toHaveLength(0);
    },
  );
});

describe("repositories.listByProject", () => {
  it("webhookSecret を除外して返す（PII/機密のクライアント露出防止）", async () => {
    const t = setup();
    const project = await seedProject(t);
    const id = await seedRepository(t, project);

    const listed = await t.query(api.repositories.listByProject, { project });

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      _id: id,
      project,
      provider: "github",
    });
    expect(listed[0]).not.toHaveProperty("webhookSecret");
  });

  it("指定プロジェクトのリポジトリのみ返す", async () => {
    const t = setup();
    const project = await seedProject(t, { key: "TASK" });
    const other = await seedProject(t, { key: "OTHER" });
    const mine = await seedRepository(t, project);
    await seedRepository(t, other, {
      remoteUrl: "https://github.com/acme/other",
    });

    const listed = await t.query(api.repositories.listByProject, { project });

    expect(listed.map((r) => r._id)).toEqual([mine]);
  });
});
