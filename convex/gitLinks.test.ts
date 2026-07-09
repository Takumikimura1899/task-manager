// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  TEST_WEBHOOK_ENCRYPTION_KEY,
  listTaskGitLinks,
  seedGitLink,
  seedMember,
  seedProject,
  seedRepository,
  type T,
} from "../test/convexSupport";

/**
 * GitLink Core API の結合テスト（基本設計書 §3 / §7 / Issue #22）。
 *
 * upsertGitLink（共有ヘルパー）は公開ミューテーション link 経由で検証する。
 * 冪等 upsert の同定キーは (task, repository, type, externalRef)。
 * 1つの Git アーティファクトが複数タスクに紐づくことを許容する（Issue #38）。
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

/** Project / Member / Issue+Task / Repository 一式を用意する。 */
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

/** link ミューテーション引数のファクトリ（既定は PR #5 の open リンク）。 */
const createLinkArgs = (
  refs: { task: Id<"tasks">; repository: Id<"repositories"> },
  overrides: Partial<{
    type: "branch" | "commit" | "pull_request";
    externalRef: string;
    url: string;
    prState: "draft" | "open" | "merged" | "closed";
  }> = {},
) => ({
  ...refs,
  type: "pull_request" as const,
  externalRef: "5",
  url: "https://github.com/acme/repo/pull/5",
  prState: "open" as const,
  ...overrides,
});

describe("gitLinks.link（冪等 upsert）", () => {
  it("新規の (task, repository, type, externalRef) は GitLink を insert する", async () => {
    const t = setup();
    const { task, repository } = await seedScenario(t);

    const id = await t.mutation(
      api.gitLinks.link,
      createLinkArgs({ task, repository }),
    );

    expect(await listTaskGitLinks(t, task)).toMatchObject([
      {
        _id: id,
        task,
        repository,
        type: "pull_request",
        externalRef: "5",
        url: "https://github.com/acme/repo/pull/5",
        prState: "open",
      },
    ]);
  });

  it("同一キーの再実行は既存リンクを patch し、件数を増やさず同じ id を返す", async () => {
    const t = setup();
    const { task, repository } = await seedScenario(t);
    const first = await t.mutation(
      api.gitLinks.link,
      createLinkArgs({ task, repository }),
    );

    const second = await t.mutation(
      api.gitLinks.link,
      createLinkArgs(
        { task, repository },
        { url: "https://github.com/acme/repo/pull/5/files", prState: "merged" },
      ),
    );

    expect(second).toBe(first);
    const links = await listTaskGitLinks(t, task);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      url: "https://github.com/acme/repo/pull/5/files",
      prState: "merged",
    });
  });

  it.each([
    { name: "externalRef が異なる", overrides: { externalRef: "6" } },
    { name: "type が異なる", overrides: { type: "branch" } },
  ] as const)(
    "$name 場合は別リンクとして insert する",
    async ({ overrides }) => {
      const t = setup();
      const { task, repository } = await seedScenario(t);
      await t.mutation(api.gitLinks.link, createLinkArgs({ task, repository }));

      await t.mutation(
        api.gitLinks.link,
        createLinkArgs({ task, repository }, overrides),
      );

      expect(await listTaskGitLinks(t, task)).toHaveLength(2);
    },
  );

  it("repository が異なれば同じ type/externalRef でも別リンクになる", async () => {
    const t = setup();
    const { project, task, repository } = await seedScenario(t);
    const otherRepo = await seedRepository(t, project, {
      remoteUrl: "https://github.com/acme/other",
    });
    await t.mutation(api.gitLinks.link, createLinkArgs({ task, repository }));

    await t.mutation(
      api.gitLinks.link,
      createLinkArgs({ task, repository: otherRepo }),
    );

    expect(await listTaskGitLinks(t, task)).toHaveLength(2);
  });

  it("同一 (repository, type, externalRef) でも task が異なれば別リンクとして insert する（Issue #38）", async () => {
    // 同定キーに task を含むため、同じ Git アーティファクトを
    // 複数タスクへ独立にリンクできる（既存リンクの task は付け替わらない）。
    const t = setup();
    const { member, issue, task, repository } = await seedScenario(t);
    const second = await t.mutation(api.tasks.create, {
      issue,
      title: "2つ目",
      createdBy: member,
    });
    const first = await t.mutation(
      api.gitLinks.link,
      createLinkArgs({ task, repository }),
    );

    const result = await t.mutation(
      api.gitLinks.link,
      createLinkArgs({ task: second, repository }, { prState: "merged" }),
    );

    expect(result).not.toBe(first);
    expect(await listTaskGitLinks(t, task)).toMatchObject([
      { task, prState: "open" },
    ]);
    expect(await listTaskGitLinks(t, second)).toMatchObject([
      { task: second, prState: "merged" },
    ]);
  });
});

describe("gitLinks.link（参照整合性 INVARIANT-3）", () => {
  it("存在しないタスクを指定すると拒否し、リンクを作らない", async () => {
    const t = setup();
    const { issue, task, repository } = await seedScenario(t);
    // Issue ごと削除して task の実体を消す（参照だけ残す）
    await t.mutation(api.issues.remove, { id: issue, expectedRevision: 0 });

    await expect(
      t.mutation(api.gitLinks.link, createLinkArgs({ task, repository })),
    ).rejects.toThrowError("指定されたタスクが存在しません");

    expect(await t.run((ctx) => ctx.db.query("gitLinks").collect())).toEqual(
      [],
    );
  });

  it("存在しないリポジトリを指定すると拒否し、リンクを作らない", async () => {
    const t = setup();
    const { task, repository } = await seedScenario(t);
    await t.run((ctx) => ctx.db.delete(repository));

    await expect(
      t.mutation(api.gitLinks.link, createLinkArgs({ task, repository })),
    ).rejects.toThrowError("指定されたリポジトリが存在しません");

    expect(await listTaskGitLinks(t, task)).toEqual([]);
  });
});

describe("gitLinks.listByTask", () => {
  it("指定タスクのリンクのみ返す（他タスクのリンクは含まない）", async () => {
    const t = setup();
    const { member, issue, task, repository } = await seedScenario(t);
    const second = await t.mutation(api.tasks.create, {
      issue,
      title: "2つ目",
      createdBy: member,
    });
    const mine = await seedGitLink(t, { task, repository });
    await seedGitLink(
      t,
      { task: second, repository },
      { externalRef: "feature/TASK-2" },
    );

    const listed = await t.query(api.gitLinks.listByTask, { task });

    expect(listed.map((l) => l._id)).toEqual([mine]);
  });

  it("リンクのないタスクは空配列を返す", async () => {
    const t = setup();
    const { task } = await seedScenario(t);

    expect(await t.query(api.gitLinks.listByTask, { task })).toEqual([]);
  });
});
