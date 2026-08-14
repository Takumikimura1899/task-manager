// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { setup } from "../test/convexSupport";

/**
 * seed（開発用デモデータ投入）の結合テスト。
 *
 * seed.demo が全タスクに同一 rank "a0" を与えると、列内の並び順が退化し、
 * 同一 rank の隣接タスク間への move が rankBetween のガードで例外になる（#13）。
 * ここでは「列（status）ごとに rank が全て相異なり、作成順（number 昇順）で
 * 単調増加である」ことを、投入後の DB の最終状態で検証する。
 */

describe("seed.demo", () => {
  it("2回実行してもプロジェクトは1件のまま増えず、既存データも変化しない（冪等性 #50）", async () => {
    const t = setup();
    const first = await t.mutation(internal.seed.demo, {});
    expect(first.status).toBe("created");

    const snapshotAfterFirst = await t.run(async (ctx) => ({
      projects: await ctx.db.query("projects").collect(),
      issues: await ctx.db.query("issues").collect(),
      tasks: await ctx.db.query("tasks").collect(),
      members: await ctx.db.query("members").collect(),
    }));

    // 2回目はスキップされ、その旨が返り値で呼び出し元に伝わる（サイレント失敗の回避）
    const second = await t.mutation(internal.seed.demo, {});
    expect(second.status).toBe("skipped");
    expect(second.message).toContain("TASK");

    const snapshotAfterSecond = await t.run(async (ctx) => ({
      projects: await ctx.db.query("projects").collect(),
      issues: await ctx.db.query("issues").collect(),
      tasks: await ctx.db.query("tasks").collect(),
      members: await ctx.db.query("members").collect(),
    }));

    // key="TASK" のプロジェクトが重複しない（.unique() 経路のクラッシュ原因の排除）
    expect(
      snapshotAfterSecond.projects.filter((p) => p.key === "TASK"),
    ).toHaveLength(1);
    // 既存データが一切変化しない（追加・変更なし）
    expect(snapshotAfterSecond).toEqual(snapshotAfterFirst);
  });

  it("生成タスクの rank は列内で全て相異なり、作成順に単調増加である", async () => {
    const t = setup();
    await t.mutation(internal.seed.demo, {});

    const tasks = await t.run((ctx) => ctx.db.query("tasks").collect());
    expect(tasks.length).toBeGreaterThan(1);

    // 列（status）ごとに作成順（number 昇順）へ並べ、rank 系列を取り出す
    const ranksByStatus = new Map<string, string[]>();
    for (const task of tasks.toSorted((a, b) => a.number - b.number)) {
      const ranks = ranksByStatus.get(task.status) ?? [];
      ranks.push(task.rank);
      ranksByStatus.set(task.status, ranks);
    }

    for (const [status, ranks] of ranksByStatus) {
      // 重複なし（同一 rank は move 時の before >= after ガード例外の原因）
      expect(new Set(ranks).size, `status=${status} の rank が重複`).toBe(
        ranks.length,
      );
      // 作成順で厳密に昇順（ボード上の表示順が作成順と一致する）
      expect(ranks, `status=${status} の rank が昇順でない`).toEqual(
        ranks.toSorted(),
      );
    }
  });
});

describe("seed.demoAuth", () => {
  it("デモ member のログイン用アカウントを作成し、招待ゲート経由でリンクする", async () => {
    const t = setup();
    await t.mutation(internal.seed.demo, {});

    const result = await t.action(internal.seed.demoAuth, {
      password: "password123",
    });
    expect(result.status).toBe("created");

    const { member, account } = await t.run(async (ctx) => {
      const members = await ctx.db.query("members").collect();
      const accounts = await ctx.db.query("authAccounts").collect();
      return { member: members[0], account: accounts[0] };
    });
    // member が authUser にリンクされ、招待トークンは使い捨てで消えている
    expect(member?.authUserId).toBeDefined();
    expect(member?.inviteTokenHash).toBeUndefined();
    // password provider のアカウントがデモ email で作成されている
    expect(account?.provider).toBe("password");
    expect(account?.providerAccountId).toBe("taro@example.com");
    expect(account?.userId).toBe(member?.authUserId);
  });

  it("既にリンク済みなら skipped を返し、何も変更しない（冪等性）", async () => {
    const t = setup();
    await t.mutation(internal.seed.demo, {});
    await t.action(internal.seed.demoAuth, { password: "password123" });

    const before = await t.run(async (ctx) => ({
      accounts: await ctx.db.query("authAccounts").collect(),
      members: await ctx.db.query("members").collect(),
    }));

    const second = await t.action(internal.seed.demoAuth, {
      password: "different-password",
    });
    expect(second.status).toBe("skipped");

    const after = await t.run(async (ctx) => ({
      accounts: await ctx.db.query("authAccounts").collect(),
      members: await ctx.db.query("members").collect(),
    }));
    expect(after).toEqual(before);
  });

  it("seed:demo 未実行なら明示的に拒否する", async () => {
    const t = setup();
    await expect(
      t.action(internal.seed.demoAuth, { password: "password123" }),
    ).rejects.toThrow(/seed:demo/);
  });

  it("8文字未満のパスワードを拒否する（UI の minLength と同一要件）", async () => {
    const t = setup();
    await t.mutation(internal.seed.demo, {});
    await expect(
      t.action(internal.seed.demoAuth, { password: "short" }),
    ).rejects.toThrow(/8文字以上/);
  });
});
