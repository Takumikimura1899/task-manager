// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { seedAuthedMember, seedProject } from "../test/convexSupport";

/**
 * Project Core API の結合テスト（基本設計書 §3 / Issue #22）。
 *
 * キー形式の判定自体（isValidProjectKey）は lib/validators.test.ts で単体検証済み。
 * ここでは「ミューテーションが検証・一意性（INVARIANT）を正しく結線しているか」を
 * DB の最終状態と返り値で検証する（古典学派・結合テスト層）。
 * 全公開関数は認証ゲート（Issue #1 PR2）配下のため、呼び出しは
 * seedAuthedMember が返す `as`（認証済み identity）で行う。
 */

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const setup = () => convexTest(schema, modules);

describe("projects.create", () => {
  it("採番カウンタを 1 で初期化して Project を作成する（INVARIANT-1 の起点）", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);

    const id = await as.mutation(api.projects.create, {
      key: "TASK",
      name: "タスク管理",
      description: "説明",
    });

    const doc = await t.run((ctx) => ctx.db.get(id));
    expect(doc).toMatchObject({
      key: "TASK",
      name: "タスク管理",
      description: "説明",
      nextTaskNumber: 1,
      nextIssueNumber: 1,
    });
  });

  it("重複キーを拒否し、Project を追加しない（キー一意性の INVARIANT）", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);
    await seedProject(t, { key: "TASK" });

    await expect(
      as.mutation(api.projects.create, { key: "TASK", name: "重複" }),
    ).rejects.toThrowError('プロジェクトキー "TASK" は既に使用されています');

    // 失敗したトランザクションは何も書き込まない
    expect(await as.query(api.projects.list, {})).toHaveLength(1);
  });

  it.each([
    { name: "小文字を含む", key: "task" },
    { name: "数字を含む", key: "TASK1" },
    { name: "記号を含む", key: "TA-SK" },
    { name: "1文字（下限未満）", key: "A" },
    { name: "11文字（上限超過）", key: "ABCDEFGHIJK" },
    { name: "空文字", key: "" },
  ])('不正なキー（$name: "$key"）を拒否する', async ({ key }) => {
    const t = setup();
    const { as } = await seedAuthedMember(t);

    await expect(
      as.mutation(api.projects.create, { key, name: "x" }),
    ).rejects.toThrowError("プロジェクトキーが不正です");
    expect(await as.query(api.projects.list, {})).toHaveLength(0);
  });

  it.each([
    { name: "下限の2文字", key: "AB" },
    { name: "上限の10文字", key: "ABCDEFGHIJ" },
  ])('境界のキー（$name: "$key"）を受け付ける', async ({ key }) => {
    const t = setup();
    const { as } = await seedAuthedMember(t);

    const id = await as.mutation(api.projects.create, { key, name: "x" });

    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ key });
  });
});

describe("projects.getByKey", () => {
  it("キーに一致する Project を返す", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);
    const id = await seedProject(t, { key: "TASK", name: "対象" });
    await seedProject(t, { key: "OTHER", name: "別物" });

    const found = await as.query(api.projects.getByKey, { key: "TASK" });

    expect(found).toMatchObject({ _id: id, key: "TASK", name: "対象" });
  });

  it("存在しないキーは null を返す", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);
    await seedProject(t, { key: "TASK" });

    expect(await as.query(api.projects.getByKey, { key: "NONE" })).toBeNull();
  });
});

describe("projects.list", () => {
  it("登録済みの全 Project を返す（空なら空配列）", async () => {
    const t = setup();
    const { as } = await seedAuthedMember(t);
    expect(await as.query(api.projects.list, {})).toEqual([]);

    await seedProject(t, { key: "TASK" });
    await seedProject(t, { key: "OTHER" });

    const listed = await as.query(api.projects.list, {});
    expect(listed.map((p) => p.key).toSorted()).toEqual(["OTHER", "TASK"]);
  });
});

describe("projects の認証ゲート（Issue #1 PR2）", () => {
  it("未認証の呼び出しは ConvexError で拒否する", async () => {
    const t = setup();

    await expect(t.query(api.projects.list, {})).rejects.toThrowError(
      "認証が必要です",
    );
  });
});
