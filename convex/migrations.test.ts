// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  getTask,
  seedAuthedMember,
  seedProject,
  setup,
  type As,
} from "../test/convexSupport";

/**
 * migrations.repairDuplicateRanks の結合テスト。
 *
 * 修復対象の重複 rank は、以前の move/transitionStatus が可視カードの
 * 隣接 rank 文字列をクライアントから受け取っていたことで発行されていた
 * （現在は convex/tasks.ts の rankForInsert がサーバー側で実隣接を再導出する
 * ため新規発生しない）。ここでは既存データの重複を t.run で直接注入し、
 * 修復の観測可能な結果（一意な rank・列順の保存・冪等性）を検証する。
 */

/** Issue と最初の Task を Core API 経由で作成する（INVARIANT-5 を尊重）。 */
const seedIssueWithTask = (as: As, project: Id<"projects">) =>
  as.mutation(api.issues.create, {
    project,
    title: "課題",
    firstTask: { title: "最初のタスク" },
  });

/** backlog 列の Task を rank 昇順（＝ボード表示順）に _id で返す。 */
const columnIds = async (
  as: As,
  project: Id<"projects">,
): Promise<Id<"tasks">[]> => {
  const board = await as.query(api.tasks.board, { project });
  const column = board.find((c) => c.status === "backlog");
  return (column?.tasks ?? []).map((task) => task._id);
};

describe("migrations.repairDuplicateRanks", () => {
  it("重複 rank を修復して列の _id 順序を保ち、2回目の実行は冪等（tasksRepatched=0）", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t);
    const { issue, task: a } = await seedIssueWithTask(as, project);
    const b = await as.mutation(api.tasks.create, { issue, title: "B" });
    const c = await as.mutation(api.tasks.create, { issue, title: "C" });

    // b・c の rank を a と同一に破壊する（実運用で発生した重複発行を模す）。
    const aRank = (await getTask(t, a))!.rank;
    await t.run((ctx) => ctx.db.patch(b, { rank: aRank }));
    await t.run((ctx) => ctx.db.patch(c, { rank: aRank }));

    // rank が同値でも _creationTime タイブレークにより走査順は決定的
    // （作成順 a → b → c）。
    const before = await columnIds(as, project);
    expect(before).toEqual([a, b, c]);

    const first = await t.mutation(
      internal.migrations.repairDuplicateRanks,
      {},
    );
    expect(first.columnsRepaired).toBe(1);
    expect(first.tasksRepatched).toBeGreaterThan(0);

    // 修復後も _id の列順は変わらない。
    const after = await columnIds(as, project);
    expect(after).toEqual(before);

    // rank は一意かつ厳密昇順になっている。
    const ranks = await Promise.all(
      after.map(async (id) => (await getTask(t, id))!.rank),
    );
    expect(new Set(ranks).size).toBe(ranks.length);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i - 1] < ranks[i]).toBe(true);
    }

    // 冪等性: 重複が解消済みのため2回目は何も修復しない。
    const second = await t.mutation(
      internal.migrations.repairDuplicateRanks,
      {},
    );
    expect(second).toEqual({
      scanned: first.scanned,
      columnsRepaired: 0,
      tasksRepatched: 0,
    });
  });

  it("重複が無ければ何も変更しない（scanned のみ進む）", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t);
    await seedIssueWithTask(as, project);

    const result = await t.mutation(
      internal.migrations.repairDuplicateRanks,
      {},
    );

    expect(result.columnsRepaired).toBe(0);
    expect(result.tasksRepatched).toBe(0);
    expect(result.scanned).toBeGreaterThan(0);
  });
});
