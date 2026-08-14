// @vitest-environment edge-runtime
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type As,
  getProjectMember,
  getTask,
  seedAuthedMember,
  seedIssueWithTask,
  seedMember,
  seedProject,
  seedProjectMember,
  setup,
} from "../test/convexSupport";

/**
 * migrations.repairDuplicateRanks の結合テスト。
 *
 * 修復対象の重複 rank は、以前の move/transitionStatus が可視カードの
 * 隣接 rank 文字列をクライアントから受け取っていたことで発行されていた
 * （現在は convex/tasks.ts の rankForInsert がサーバー側で実隣接を再導出する
 * ため新規発生しない）。ここでは既存データの重複を t.run で直接注入し、
 * 修復の観測可能な結果（一意な rank・列順の保存・冪等性）を検証する。
 * seedIssueWithTask は test/convexSupport.ts に一元化（tasks.test.ts と共有）。
 */

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

/** projectId・memberId のペアで membership の role を引く（結果の最終状態検証用）。 */
const membershipRole = async (
  t: ReturnType<typeof setup>,
  project: Id<"projects">,
  member: Id<"members">,
) => (await getProjectMember(t, project, member))?.role ?? null;

describe("migrations.backfillProjectMembers（ADR-11 §6）", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("MCP_AGENT_EMAIL 未設定なら、全ての人間 Member を owner として付与する", async () => {
    const t = setup();
    const project = await seedProject(t);
    const alice = await seedMember(t, {
      name: "Alice",
      email: "alice@example.com",
    });
    const bob = await seedMember(t, { name: "Bob", email: "bob@example.com" });

    const result = await t.mutation(
      internal.migrations.backfillProjectMembers,
      {},
    );

    expect(result).toEqual({
      projects: 1,
      members: 2,
      inserted: 2,
      skipped: 0,
    });
    expect(await membershipRole(t, project, alice)).toBe("owner");
    expect(await membershipRole(t, project, bob)).toBe("owner");
  });

  it("MCP_AGENT_EMAIL に一致する Member は member、それ以外の人間 Member は owner として付与する", async () => {
    const t = setup();
    vi.stubEnv("MCP_AGENT_EMAIL", "agent@example.com");
    const project = await seedProject(t);
    const human = await seedMember(t, {
      name: "Alice",
      email: "alice@example.com",
    });
    const agent = await seedMember(t, {
      name: "Agent",
      email: "agent@example.com",
    });

    await t.mutation(internal.migrations.backfillProjectMembers, {});

    expect(await membershipRole(t, project, human)).toBe("owner");
    expect(await membershipRole(t, project, agent)).toBe("member");
  });

  it("既存の membership はスキップし、role を上書きしない", async () => {
    const t = setup();
    const project = await seedProject(t);
    const alice = await seedMember(t, {
      name: "Alice",
      email: "alice@example.com",
    });
    // ADR-11 以前に何らかの経路で member として作られていた既存行を模す。
    await seedProjectMember(t, project, alice, "member");

    const result = await t.mutation(
      internal.migrations.backfillProjectMembers,
      {},
    );

    expect(result).toEqual({
      projects: 1,
      members: 1,
      inserted: 0,
      skipped: 1,
    });
    expect(await membershipRole(t, project, alice)).toBe("member");
  });

  it("再実行しても membership が増えない（冪等性）", async () => {
    const t = setup();
    const project = await seedProject(t);
    const alice = await seedMember(t, {
      name: "Alice",
      email: "alice@example.com",
    });

    const first = await t.mutation(
      internal.migrations.backfillProjectMembers,
      {},
    );
    const second = await t.mutation(
      internal.migrations.backfillProjectMembers,
      {},
    );

    expect(first.inserted).toBe(1);
    expect(second).toEqual({
      projects: 1,
      members: 1,
      inserted: 0,
      skipped: 1,
    });
    const all = await t.run((ctx) =>
      ctx.db
        .query("projectMembers")
        .withIndex("by_project_and_member", (q) => q.eq("project", project))
        .collect(),
    );
    expect(all).toHaveLength(1);
    expect(all[0].member).toBe(alice);
  });
});
