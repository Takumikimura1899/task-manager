// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

/**
 * seed（開発用デモデータ投入）の結合テスト。
 *
 * seed.demo が全タスクに同一 rank "a0" を与えると、列内の並び順が退化し、
 * 同一 rank の隣接タスク間への move が rankBetween のガードで例外になる（#13）。
 * ここでは「列（status）ごとに rank が全て相異なり、作成順（number 昇順）で
 * 単調増加である」ことを、投入後の DB の最終状態で検証する。
 */

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const setup = () => convexTest(schema, modules);

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
