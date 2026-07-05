// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { seedMember, type T } from "../../test/convexSupport";
import { resolveMemberName, resolveMemberNames } from "./members";

/**
 * member 表示名解決ヘルパーのテスト（Issue #22）。
 *
 * ロジックは純粋寄りだが ctx.db.get に依存するため、convex-test の
 * インメモリ DB を実物として通す（内部モック禁止・古典学派）。
 * 関数参照の解決は不要なので t.run のみ使用する。
 */

const modules = import.meta.glob(["../**/*.ts", "!../**/*.test.ts"]);
const setup = () => convexTest(schema, modules);

/** 削除済み member の id を作る（実体のないダングリング参照）。 */
const seedDeletedMember = async (t: T) => {
  const id = await seedMember(t, { email: "ghost@example.com" });
  await t.run((ctx) => ctx.db.delete(id));
  return id;
};

describe("resolveMemberName", () => {
  it("存在する member の name を返す（PII の email は返さない設計）", async () => {
    const t = setup();
    const id = await seedMember(t, { name: "Alice" });

    expect(await t.run((ctx) => resolveMemberName(ctx, id))).toBe("Alice");
  });

  it("id が undefined（未割り当て）なら null を返す", async () => {
    const t = setup();

    expect(await t.run((ctx) => resolveMemberName(ctx, undefined))).toBeNull();
  });

  it("実体が欠落した id（削除済み）なら null を返す", async () => {
    const t = setup();
    const ghost = await seedDeletedMember(t);

    expect(await t.run((ctx) => resolveMemberName(ctx, ghost))).toBeNull();
  });
});

// t.run の返り値は Convex 値として直列化されるため、Map は entries 配列に変換して返す
const resolveEntries = (
  t: T,
  ids: readonly (Id<"members"> | undefined)[],
): Promise<[Id<"members">, string][]> =>
  t.run(async (ctx) => [...(await resolveMemberNames(ctx, ids)).entries()]);

describe("resolveMemberNames", () => {
  it("重複 id を集約し、id ごとに1エントリの Map を返す", async () => {
    const t = setup();
    const alice = await seedMember(t, { name: "Alice" });
    const bob = await seedMember(t, { name: "Bob", email: "bob@example.com" });

    const entries = await resolveEntries(t, [alice, bob, alice, alice]);

    expect(entries.toSorted()).toEqual(
      [
        [alice, "Alice"],
        [bob, "Bob"],
      ].toSorted(),
    );
  });

  it("undefined と欠落 id は結果に含めない（解決できた分だけ返す）", async () => {
    const t = setup();
    const alice = await seedMember(t, { name: "Alice" });
    const ghost = await seedDeletedMember(t);

    const entries = await resolveEntries(t, [
      undefined,
      alice,
      ghost,
      undefined,
    ]);

    expect(entries).toEqual([[alice, "Alice"]]);
  });

  it("空配列なら空の Map を返す", async () => {
    const t = setup();

    expect(await resolveEntries(t, [])).toEqual([]);
  });
});
