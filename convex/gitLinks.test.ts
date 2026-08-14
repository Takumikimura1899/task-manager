// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  TEST_WEBHOOK_ENCRYPTION_KEY,
  listTaskGitLinks,
  seedGitLink,
  seedProject,
  seedRepository,
  seedTaskWithRepository,
  setup,
} from "../test/convexSupport";

/**
 * GitLink Core API の結合テスト（基本設計書 §3 / §7 / Issue #22）。
 *
 * upsertGitLink（共有ヘルパー）は公開ミューテーション link 経由で検証する。
 * 冪等 upsert の同定キーは (task, repository, type, externalRef)。
 * 1つの Git アーティファクトが複数タスクに紐づくことを許容する（Issue #38）。
 */

// seedRepository が webhookSecret を暗号化するため、本番同様に環境変数で鍵を注入する
beforeEach(() => {
  vi.stubEnv("WEBHOOK_ENCRYPTION_KEY", TEST_WEBHOOK_ENCRYPTION_KEY);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

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
    const { as, task, repository } = await seedTaskWithRepository(t);

    const id = await as.mutation(
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
    const { as, task, repository } = await seedTaskWithRepository(t);
    const first = await as.mutation(
      api.gitLinks.link,
      createLinkArgs({ task, repository }),
    );

    const second = await as.mutation(
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
      const { as, task, repository } = await seedTaskWithRepository(t);
      await as.mutation(
        api.gitLinks.link,
        createLinkArgs({ task, repository }),
      );

      await as.mutation(
        api.gitLinks.link,
        createLinkArgs({ task, repository }, overrides),
      );

      expect(await listTaskGitLinks(t, task)).toHaveLength(2);
    },
  );

  it("repository が異なれば同じ type/externalRef でも別リンクになる", async () => {
    const t = setup();
    const { as, project, task, repository } = await seedTaskWithRepository(t);
    const otherRepo = await seedRepository(t, project, {
      remoteUrl: "https://github.com/acme/other",
    });
    await as.mutation(api.gitLinks.link, createLinkArgs({ task, repository }));

    await as.mutation(
      api.gitLinks.link,
      createLinkArgs({ task, repository: otherRepo }),
    );

    expect(await listTaskGitLinks(t, task)).toHaveLength(2);
  });

  it("同一 (repository, type, externalRef) でも task が異なれば別リンクとして insert する（Issue #38）", async () => {
    // 同定キーに task を含むため、同じ Git アーティファクトを
    // 複数タスクへ独立にリンクできる（既存リンクの task は付け替わらない）。
    const t = setup();
    const { as, issue, task, repository } = await seedTaskWithRepository(t);
    const second = await as.mutation(api.tasks.create, {
      issue,
      title: "2つ目",
    });
    const first = await as.mutation(
      api.gitLinks.link,
      createLinkArgs({ task, repository }),
    );

    const result = await as.mutation(
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
    const { as, issue, task, repository } = await seedTaskWithRepository(t);
    // Issue ごと削除して task の実体を消す（参照だけ残す）
    await as.mutation(api.issues.remove, { id: issue, expectedRevision: 0 });

    // projectMutation が resolveProject（projectOfTask）の段階で拒否するため
    // 汎用メッセージになる（ADR-11 設計書 §3.5 手順2）。
    await expect(
      as.mutation(api.gitLinks.link, createLinkArgs({ task, repository })),
    ).rejects.toThrowError("指定された対象が存在しません");

    expect(await t.run((ctx) => ctx.db.query("gitLinks").collect())).toEqual(
      [],
    );
  });

  it("存在しないリポジトリを指定すると拒否し、リンクを作らない", async () => {
    const t = setup();
    const { as, task, repository } = await seedTaskWithRepository(t);
    await t.run((ctx) => ctx.db.delete(repository));

    await expect(
      as.mutation(api.gitLinks.link, createLinkArgs({ task, repository })),
    ).rejects.toThrowError("指定されたリポジトリが存在しません");

    expect(await listTaskGitLinks(t, task)).toEqual([]);
  });
});

describe("gitLinks.link のクロスプロジェクト拒否（設計書 §4 の厳格化）", () => {
  it("task と repository が別プロジェクトに属する場合は拒否し、リンクを作らない", async () => {
    const t = setup();
    const { as, project, task } = await seedTaskWithRepository(t);
    const otherProject = await seedProject(t, { key: "OTHER" });
    const crossProjectRepo = await seedRepository(t, otherProject, {
      remoteUrl: "https://github.com/acme/other",
    });
    // 呼び出し元は task 側（project）の owner のまま。membership 判定自体は
    // 通過し、handler 内の repository.project === task.project 検証で拒否される
    // ことを確認する（projectMutation のゲート拒否とは異なる不変条件）。

    await expect(
      as.mutation(
        api.gitLinks.link,
        createLinkArgs({ task, repository: crossProjectRepo }),
      ),
    ).rejects.toThrowError(
      "指定されたリポジトリは対象タスクのプロジェクトに属していません",
    );

    expect(await listTaskGitLinks(t, task)).toEqual([]);
    expect(project).not.toBe(otherProject); // 前提の確認（別プロジェクトである）
  });
});

describe("gitLinks.listByTask", () => {
  it("指定タスクのリンクのみ返す（他タスクのリンクは含まない）", async () => {
    const t = setup();
    const { as, issue, task, repository } = await seedTaskWithRepository(t);
    const second = await as.mutation(api.tasks.create, {
      issue,
      title: "2つ目",
    });
    const mine = await seedGitLink(t, { task, repository });
    await seedGitLink(
      t,
      { task: second, repository },
      { externalRef: "feature/TASK-2" },
    );

    const listed = (await as.query(api.gitLinks.listByTask, { task }))!;

    expect(listed.map((l) => l._id)).toEqual([mine]);
  });

  it("リンクのないタスクは空配列を返す", async () => {
    const t = setup();
    const { as, task } = await seedTaskWithRepository(t);

    expect(await as.query(api.gitLinks.listByTask, { task })).toEqual([]);
  });
});
