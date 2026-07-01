import type { TestConvex } from "convex-test";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";

/**
 * Convex 結合テスト（convex-test）の共有セットアップ・ファクトリ。
 *
 * convex/ の外に置くのは意図的:
 * - convex/ 配下の非 test ファイルは `convex dev`/`deploy` のバンドル対象になり、
 *   ここが `convex-test` 等を参照すると本番デプロイを壊す（convex/tsconfig の
 *   include は全ファイル（./ 配下を再帰）で、test ファイルのみ CLI が除外する）。
 * - このファイルは convex-test を「型としてのみ」参照し（実体 import は各 test の
 *   setup 側）、convex のスキャン範囲外に置くことで巻き込みを完全に回避する。
 * - vitest の収集対象（*.test/*.spec）にも該当しないため単独実行もされない。
 *
 * schema 由来のファクトリ（seedProject / seedMember）を一元化し、スキーマ変更時の
 * 二重修正・ドリフトを防ぐ。
 */

export type T = TestConvex<typeof schema>;

/** projects を1件 seed する。採番カウンタは既定で 1 から。 */
export const seedProject = (
  t: T,
  overrides: Partial<{
    key: string;
    name: string;
    nextTaskNumber: number;
    nextIssueNumber: number;
  }> = {},
) =>
  t.run((ctx) =>
    ctx.db.insert("projects", {
      key: "TASK",
      name: "Test Project",
      nextTaskNumber: 1,
      nextIssueNumber: 1,
      ...overrides,
    }),
  );

/** members を1件 seed する。複数作る場合は email をオーバーライドして衝突を避ける。 */
export const seedMember = (
  t: T,
  overrides: Partial<{
    name: string;
    email: string;
    role: "admin" | "member";
  }> = {},
) =>
  t.run((ctx) =>
    ctx.db.insert("members", {
      name: "Alice",
      email: "alice@example.com",
      role: "member",
      ...overrides,
    }),
  );

/** id から素の Task ドキュメントを取得する（最終状態の検証用）。 */
export const getTask = (t: T, id: Id<"tasks">) =>
  t.run((ctx) => ctx.db.get(id));
