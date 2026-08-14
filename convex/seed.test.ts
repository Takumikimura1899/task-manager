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

  it("デモ email の member が既に存在する場合（例: ブートストラップサインアップ）は再利用し重複させない", async () => {
    const t = setup();
    // ブートストラップサインアップ（convex/lib/memberLink.ts）相当:
    // プロジェクトがまだ無い状態で taro@example.com の member が先に存在するケース。
    const existingMemberId = await t.run((ctx) =>
      ctx.db.insert("members", {
        name: "太郎",
        email: "taro@example.com",
        role: "admin",
      }),
    );

    const result = await t.mutation(internal.seed.demo, {});
    expect(result.status).toBe("created");
    // 既存 member を再利用したため、新規の招待トークンは発行しない
    expect(result.inviteToken).toBeUndefined();

    const members = await t.run((ctx) => ctx.db.query("members").collect());
    const demoMembers = members.filter((m) => m.email === "taro@example.com");
    // 重複せず1件のまま（by_email の .unique() を使う全経路が壊れないことの確認）
    expect(demoMembers).toHaveLength(1);
    expect(demoMembers[0]?._id).toBe(existingMemberId);
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

  it("既存の authAccounts が残っていると loud に失敗し、member はリンクされないまま残る（指摘1）", async () => {
    const t = setup();
    await t.mutation(internal.seed.demo, {});

    // 過去の seed:demoAuth の部分失敗・手動操作等で authAccounts だけが残って
    // しまった状態を再現する。createAccountFromCredentialsImpl は既存の
    // provider/providerAccountId 行を見つけると upsertUserAndAccount（＝招待ゲート
    // linkAuthUserToMember 経由の member リンク）をスキップして早期 return するため、
    // 無対策だと member が未リンクのまま "created" と誤報告されてしまう。
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {});
      await ctx.db.insert("authAccounts", {
        provider: "password",
        providerAccountId: "taro@example.com",
        userId,
        secret: "not-a-real-hash",
      });
    });

    await expect(
      t.action(internal.seed.demoAuth, { password: "password123" }),
    ).rejects.toThrow(/seed:reset/);

    const member = await t.run(async (ctx) => {
      const members = await ctx.db.query("members").collect();
      return members.find((m) => m.email === "taro@example.com");
    });
    // 招待ゲートを通っていないため、authUserId はリンクされない
    expect(member?.authUserId).toBeUndefined();
  });

  it("authUserId がダングリング（参照先の users doc が存在しない）場合は未リンク扱いにして再リンクできる（指摘10）", async () => {
    const t = setup();
    await t.mutation(internal.seed.demo, {});
    await t.action(internal.seed.demoAuth, { password: "password123" });

    const linkedMember = await t.run(async (ctx) => {
      const members = await ctx.db.query("members").collect();
      return members.find((m) => m.email === "taro@example.com");
    });
    const linkedUserId = linkedMember?.authUserId;
    expect(linkedUserId).toBeDefined();
    if (linkedUserId === undefined) throw new Error("unreachable");

    // users doc だけが失われたダングリングリンクを再現する
    // （手動削除・過去の作り直しの取り残し等を想定）。
    await t.run((ctx) => ctx.db.delete(linkedUserId));

    const prepared = await t.mutation(internal.seed.prepareDemoAuth, {});
    expect(prepared.status).toBe("ready");

    const memberAfter = await t.run(async (ctx) => {
      const members = await ctx.db.query("members").collect();
      return members.find((m) => m.email === "taro@example.com");
    });
    // 未リンク扱いへ戻り、新しい招待トークンで再リンクできる状態になっている
    expect(memberAfter?.authUserId).toBeUndefined();
    expect(memberAfter?.inviteTokenHash).toBeDefined();
  });
});
