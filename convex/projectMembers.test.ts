// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import {
  seedAuthedMember,
  seedMember,
  seedProject,
  seedProjectMember,
  setup,
} from "../test/convexSupport";

/**
 * ProjectMember 管理 mutation 群（ADR-11 §5）の結合テスト（convex-test）。
 *
 * 観測可能な振る舞い（返り値・DB 状態）で検証する。
 * OCC の並行挙動（同時 leave で owner 0 名にならない等）は convex-test が
 * 単一トランザクション直列実行のため原理的に検証できない。偽の並行テストは
 * 書かない（設計文書 §10）。
 */

describe("projectMembers.add", () => {
  it("owner はメンバーを追加できる", async () => {
    const t = setup();
    const { as, memberId: owner } = await seedAuthedMember(t);
    const project = await seedProject(t);
    await seedProjectMember(t, project, owner, "owner");
    const bob = await seedMember(t, { name: "Bob", email: "bob@example.com" });

    const id = await as.mutation(api.projectMembers.add, {
      project,
      member: bob,
      role: "member",
    });

    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
      project,
      member: bob,
      role: "member",
    });
  });

  it("既に参加済みのメンバーへの重複追加を拒否する", async () => {
    const t = setup();
    const { as, memberId: owner } = await seedAuthedMember(t);
    const project = await seedProject(t);
    await seedProjectMember(t, project, owner, "owner");
    const bob = await seedMember(t, { name: "Bob", email: "bob@example.com" });
    await seedProjectMember(t, project, bob, "member");

    await expect(
      as.mutation(api.projectMembers.add, {
        project,
        member: bob,
        role: "member",
      }),
    ).rejects.toThrowError("既にプロジェクトに参加しています");
  });

  it("member ロールによる追加操作を拒否する（project.members.manage は owner 専用）", async () => {
    const t = setup();
    const { as, memberId: plainMember } = await seedAuthedMember(t);
    const project = await seedProject(t);
    await seedProjectMember(t, project, plainMember, "member");
    const bob = await seedMember(t, { name: "Bob", email: "bob@example.com" });

    await expect(
      as.mutation(api.projectMembers.add, {
        project,
        member: bob,
        role: "member",
      }),
    ).rejects.toThrowError("この操作を行う権限がありません");
  });

  it("非参加者による追加操作を拒否する", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t);
    const bob = await seedMember(t, { name: "Bob", email: "bob@example.com" });

    await expect(
      as.mutation(api.projectMembers.add, {
        project,
        member: bob,
        role: "member",
      }),
    ).rejects.toThrowError("このプロジェクトに参加していません");
  });
});

describe("projectMembers.changeRole", () => {
  it("owner はメンバーのロールを変更できる（member→owner の昇格）", async () => {
    const t = setup();
    const { as, memberId: owner } = await seedAuthedMember(t);
    const project = await seedProject(t);
    await seedProjectMember(t, project, owner, "owner");
    const bob = await seedMember(t, { name: "Bob", email: "bob@example.com" });
    const bobMembership = await seedProjectMember(t, project, bob, "member");

    await as.mutation(api.projectMembers.changeRole, {
      project,
      member: bob,
      role: "owner",
    });

    expect(await t.run((ctx) => ctx.db.get(bobMembership))).toMatchObject({
      role: "owner",
    });
  });

  it("owner が2名いる場合は片方を member へ降格できる", async () => {
    const t = setup();
    const { as, memberId: owner } = await seedAuthedMember(t);
    const project = await seedProject(t);
    await seedProjectMember(t, project, owner, "owner");
    const bob = await seedMember(t, { name: "Bob", email: "bob@example.com" });
    const bobMembership = await seedProjectMember(t, project, bob, "owner");

    await as.mutation(api.projectMembers.changeRole, {
      project,
      member: bob,
      role: "member",
    });

    expect(await t.run((ctx) => ctx.db.get(bobMembership))).toMatchObject({
      role: "member",
    });
  });

  it("最後の owner の降格を拒否する（INVARIANT-6）", async () => {
    const t = setup();
    const { as, memberId: owner } = await seedAuthedMember(t);
    const project = await seedProject(t);
    const ownerMembership = await seedProjectMember(t, project, owner, "owner");

    await expect(
      as.mutation(api.projectMembers.changeRole, {
        project,
        member: owner,
        role: "member",
      }),
    ).rejects.toThrowError("最後の owner は降格・除名・脱退できません");

    // ロールは変更されていない
    expect(await t.run((ctx) => ctx.db.get(ownerMembership))).toMatchObject({
      role: "owner",
    });
  });
});

describe("projectMembers.remove", () => {
  it("owner は他メンバーを除名できる", async () => {
    const t = setup();
    const { as, memberId: owner } = await seedAuthedMember(t);
    const project = await seedProject(t);
    await seedProjectMember(t, project, owner, "owner");
    const bob = await seedMember(t, { name: "Bob", email: "bob@example.com" });
    const bobMembership = await seedProjectMember(t, project, bob, "member");

    await as.mutation(api.projectMembers.remove, { project, member: bob });

    expect(await t.run((ctx) => ctx.db.get(bobMembership))).toBeNull();
  });

  it("最後の owner の除名を拒否する（INVARIANT-6）", async () => {
    const t = setup();
    const { as, memberId: owner } = await seedAuthedMember(t);
    const project = await seedProject(t);
    const ownerMembership = await seedProjectMember(t, project, owner, "owner");

    await expect(
      as.mutation(api.projectMembers.remove, { project, member: owner }),
    ).rejects.toThrowError("最後の owner は降格・除名・脱退できません");

    expect(await t.run((ctx) => ctx.db.get(ownerMembership))).not.toBeNull();
  });

  it("owner が2名いる場合は自分自身を除名できる（＝脱退と同義）", async () => {
    const t = setup();
    const { as, memberId: owner } = await seedAuthedMember(t);
    const project = await seedProject(t);
    const ownerMembership = await seedProjectMember(t, project, owner, "owner");
    const bob = await seedMember(t, { name: "Bob", email: "bob@example.com" });
    await seedProjectMember(t, project, bob, "owner");

    await as.mutation(api.projectMembers.remove, { project, member: owner });

    expect(await t.run((ctx) => ctx.db.get(ownerMembership))).toBeNull();
  });

  it("member ロールによる除名操作を拒否する（project.members.manage は owner 専用）", async () => {
    const t = setup();
    const { as, memberId: plainMember } = await seedAuthedMember(t);
    const project = await seedProject(t);
    await seedProjectMember(t, project, plainMember, "member");
    const bob = await seedMember(t, { name: "Bob", email: "bob@example.com" });
    await seedProjectMember(t, project, bob, "member");

    await expect(
      as.mutation(api.projectMembers.remove, { project, member: bob }),
    ).rejects.toThrowError("この操作を行う権限がありません");
  });
});

describe("projectMembers.leave", () => {
  it("owner が2名いる場合は脱退できる", async () => {
    const t = setup();
    const { as, memberId: owner } = await seedAuthedMember(t);
    const project = await seedProject(t);
    const ownerMembership = await seedProjectMember(t, project, owner, "owner");
    const bob = await seedMember(t, { name: "Bob", email: "bob@example.com" });
    await seedProjectMember(t, project, bob, "owner");

    await as.mutation(api.projectMembers.leave, { project });

    expect(await t.run((ctx) => ctx.db.get(ownerMembership))).toBeNull();
  });

  it("member ロールでも自ら脱退できる", async () => {
    const t = setup();
    const { memberId: owner } = await seedAuthedMember(t);
    const project = await seedProject(t);
    await seedProjectMember(t, project, owner, "owner");
    const { as: asBob, memberId: bob } = await seedAuthedMember(t, {
      email: "bob@example.com",
    });
    const bobMembership = await seedProjectMember(t, project, bob, "member");

    await asBob.mutation(api.projectMembers.leave, { project });

    expect(await t.run((ctx) => ctx.db.get(bobMembership))).toBeNull();
  });

  it("最後の owner の脱退を拒否する（INVARIANT-6）", async () => {
    const t = setup();
    const { as, memberId: owner } = await seedAuthedMember(t);
    const project = await seedProject(t);
    const ownerMembership = await seedProjectMember(t, project, owner, "owner");

    await expect(
      as.mutation(api.projectMembers.leave, { project }),
    ).rejects.toThrowError("最後の owner は降格・除名・脱退できません");

    expect(await t.run((ctx) => ctx.db.get(ownerMembership))).not.toBeNull();
  });

  it("非参加者の脱退を拒否する", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t);

    await expect(
      as.mutation(api.projectMembers.leave, { project }),
    ).rejects.toThrowError("このプロジェクトに参加していません");
  });
});

describe("projectMembers.listByProject", () => {
  it("参加メンバーは所属プロジェクトのメンバー一覧（role・member 情報）を取得できる", async () => {
    const t = setup();
    const { as, memberId: owner } = await seedAuthedMember(t, {
      name: "Alice",
    });
    const project = await seedProject(t);
    await seedProjectMember(t, project, owner, "owner");
    const bob = await seedMember(t, { name: "Bob", email: "bob@example.com" });
    await seedProjectMember(t, project, bob, "member");

    const listed = await as.query(api.projectMembers.listByProject, {
      project,
    });
    expect(listed).not.toBeNull();

    expect(
      listed!
        .map((m) => ({ role: m.role, name: m.member.name }))
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    ).toEqual([
      { role: "owner", name: "Alice" },
      { role: "member", name: "Bob" },
    ]);
  });

  it("非参加者からの参照は ConvexError で拒否する（projectQuery の membership ゲート）", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);
    const project = await seedProject(t);

    await expect(
      as.query(api.projectMembers.listByProject, { project }),
    ).rejects.toThrowError("このプロジェクトに参加していません");
  });
});

describe("projectMembers.grantProjectMembership（運用エスケープハッチ）", () => {
  it("projectKey と email を指定してメンバーシップを付与する", async () => {
    const t = setup();
    const project = await seedProject(t, { key: "TASK" });
    const bob = await seedMember(t, { name: "Bob", email: "bob@example.com" });

    const result = await t.mutation(
      internal.projectMembers.grantProjectMembership,
      { projectKey: "TASK", email: "bob@example.com", role: "owner" },
    );

    expect(result.status).toBe("granted");
    expect(await t.run((ctx) => ctx.db.get(bob))).not.toBeNull();
    const membership = await t.run((ctx) =>
      ctx.db
        .query("projectMembers")
        .withIndex("by_project_and_member", (q) =>
          q.eq("project", project).eq("member", bob),
        )
        .unique(),
    );
    expect(membership).toMatchObject({ project, member: bob, role: "owner" });
  });

  it("既に付与済みの場合は冪等（2回実行しても重複しない）", async () => {
    const t = setup();
    await seedProject(t, { key: "TASK" });
    await seedMember(t, { name: "Bob", email: "bob@example.com" });

    const first = await t.mutation(
      internal.projectMembers.grantProjectMembership,
      { projectKey: "TASK", email: "bob@example.com", role: "owner" },
    );
    const second = await t.mutation(
      internal.projectMembers.grantProjectMembership,
      { projectKey: "TASK", email: "bob@example.com", role: "owner" },
    );

    expect(first.status).toBe("granted");
    expect(second.status).toBe("already_member");
    expect(second.membershipId).toBe(first.membershipId);

    const all = await t.run((ctx) => ctx.db.query("projectMembers").collect());
    expect(all).toHaveLength(1);
  });

  it("存在しない projectKey は ConvexError で拒否する", async () => {
    const t = setup();

    await expect(
      t.mutation(internal.projectMembers.grantProjectMembership, {
        projectKey: "NONE",
        email: "bob@example.com",
        role: "owner",
      }),
    ).rejects.toThrowError('プロジェクトキー "NONE" が見つかりません');
  });

  it("存在しない email は ConvexError で拒否する", async () => {
    const t = setup();
    await seedProject(t, { key: "TASK" });

    await expect(
      t.mutation(internal.projectMembers.grantProjectMembership, {
        projectKey: "TASK",
        email: "nobody@example.com",
        role: "owner",
      }),
    ).rejects.toThrowError(
      'メールアドレス "nobody@example.com" の Member が見つかりません',
    );
  });
});
