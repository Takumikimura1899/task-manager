import { describe, expect, it } from "vitest";
import {
  hasProjectPermission,
  type ProjectPermission,
  type ProjectRole,
} from "./authz";

/**
 * プロジェクト内ロールの認可判定（ADR-11 §3.1）の単体テスト。
 * 対象は外部依存を持たない純粋関数のため、モックは不要（lib/taskStatus.test.ts と同方針）。
 *
 * §3.1 の permission 表（2ロール × 4permission = 8セル）を全網羅する
 * テーブル駆動テストで、表とコードの乖離を検出する。
 */
describe("hasProjectPermission", () => {
  const ALL_PERMISSIONS: ProjectPermission[] = [
    "project.delete",
    "project.members.manage",
    "project.settings.edit",
    "task.*",
  ];

  describe("owner — 全 permission を持つ", () => {
    it.each(ALL_PERMISSIONS.map((permission) => ({ permission })))(
      "$permission を許可する",
      ({ permission }) => {
        expect(hasProjectPermission("owner", permission)).toBe(true);
      },
    );
  });

  describe("member — task.* のみ許可し、他は拒否する", () => {
    it.each([
      { permission: "project.delete", expected: false },
      { permission: "project.members.manage", expected: false },
      { permission: "project.settings.edit", expected: false },
      { permission: "task.*", expected: true },
    ] satisfies { permission: ProjectPermission; expected: boolean }[])(
      "$permission の許否は $expected",
      ({ permission, expected }) => {
        expect(hasProjectPermission("member", permission)).toBe(expected);
      },
    );
  });

  it("未知のロールに対しては例外を投げる（静的マップに存在しないキーへのアクセス）", () => {
    // ROLE_PERMISSIONS は Record<ProjectRole, ...> のため、型システムでは
    // 到達し得ないが、実行時の防御（マップ外アクセスでの undefined.has 例外）を
    // 固定しておく。
    expect(() =>
      hasProjectPermission("guest" as ProjectRole, "task.*"),
    ).toThrow();
  });
});
