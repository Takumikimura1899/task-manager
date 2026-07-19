// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { authSubject, seedMember, seedUser } from "../test/convexSupport";

/**
 * Member Core API の結合テスト（基本設計書 §3 / Issue #22）。
 *
 * email の正規化・形式判定（normalizeEmail / isValidEmail）は
 * lib/validators.test.ts で単体検証済み。ここでは一意性（INVARIANT）の結線と、
 * list の PII 除外（未認証クライアントへ email を露出しない）を検証する。
 */

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const setup = () => convexTest(schema, modules);

describe("members.create", () => {
  it("email を正規化（trim＋小文字化）して保存する", async () => {
    const t = setup();

    const id = await t.mutation(api.members.create, {
      name: "Alice",
      email: "  Alice@Example.COM ",
      role: "admin",
    });

    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
      name: "Alice",
      email: "alice@example.com", // 正規化済みの値で保存される
      role: "admin",
    });
  });

  it("正規化後に一致する email の重複を拒否し、Member を追加しない", async () => {
    const t = setup();
    await seedMember(t, { email: "alice@example.com" });

    await expect(
      t.mutation(api.members.create, {
        name: "Impostor",
        email: " ALICE@example.com ", // 表記ゆれでも正規化後は同一
        role: "member",
      }),
    ).rejects.toThrowError(
      'メールアドレス "alice@example.com" は既に登録されています',
    );

    expect(await t.query(api.members.list, {})).toHaveLength(1);
  });

  it.each([
    { name: "@ がない", email: "plainaddress" },
    { name: "ドメインにドットがない", email: "a@b" },
    { name: "空白を含む", email: "a b@example.com" },
    { name: "ローカル部がない", email: "@example.com" },
    { name: "空文字", email: "" },
  ])('不正な email（$name: "$email"）を拒否する', async ({ email }) => {
    const t = setup();

    await expect(
      t.mutation(api.members.create, { name: "x", email, role: "member" }),
    ).rejects.toThrowError("メールアドレスが不正です");
    expect(await t.query(api.members.list, {})).toHaveLength(0);
  });
});

describe("members.getByEmail", () => {
  it("表記ゆれの入力でも正規化して照合する", async () => {
    const t = setup();
    const id = await seedMember(t, { email: "alice@example.com" });

    const found = await t.query(api.members.getByEmail, {
      email: " Alice@EXAMPLE.com ",
    });

    expect(found).toMatchObject({ _id: id, email: "alice@example.com" });
  });

  it("未登録の email は null を返す", async () => {
    const t = setup();
    await seedMember(t);

    expect(
      await t.query(api.members.getByEmail, { email: "nobody@example.com" }),
    ).toBeNull();
  });
});

describe("members.list（PII 除外）", () => {
  it("_id と name のみ返し、email・role を露出しない", async () => {
    const t = setup();
    const alice = await seedMember(t, { name: "Alice" });
    const bob = await seedMember(t, { name: "Bob", email: "bob@example.com" });

    const listed = await t.query(api.members.list, {});

    // toEqual はキー集合まで厳密比較する＝email/role が漏れていればここで落ちる
    expect(listed).toEqual([
      { _id: alice, name: "Alice" },
      { _id: bob, name: "Bob" },
    ]);
  });
});

describe("members.me（Issue #1: 招待制リンクの照会）", () => {
  it("未認証なら null を返す", async () => {
    const t = setup();

    expect(await t.query(api.members.me, {})).toBeNull();
  });

  it("認証済みでも member にリンクされていなければ null を返す（email 一致では代替しない）", async () => {
    const t = setup();
    const userId = await seedUser(t, { email: "alice@example.com" });
    // 同じ email の member が存在していても、authUserId が未設定なら me は解決しない
    await seedMember(t, { email: "alice@example.com" });
    const asAlice = t.withIdentity({ subject: authSubject(userId) });

    expect(await asAlice.query(api.members.me, {})).toBeNull();
  });

  it("リンク済みなら _id・name・role・email を返す", async () => {
    const t = setup();
    const userId = await seedUser(t, { email: "alice@example.com" });
    const memberId = await seedMember(t, {
      name: "Alice",
      email: "alice@example.com",
      role: "admin",
      authUserId: userId,
    });
    const asAlice = t.withIdentity({ subject: authSubject(userId) });

    expect(await asAlice.query(api.members.me, {})).toEqual({
      _id: memberId,
      name: "Alice",
      role: "admin",
      email: "alice@example.com",
    });
  });
});
