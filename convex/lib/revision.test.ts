import { describe, expect, it } from "vitest";
import { assertRevision, nextMeta } from "./revision";

/**
 * revision（楽観ロック・INVARIANT-2）共通ロジックの検証。
 * mutation 経由の振る舞いは convex/tasks.test.ts / issues.test.ts で担保するため、
 * ここでは共有ヘルパー単体の契約（競合検出・メタ更新）のみ確認する。
 */
describe("assertRevision", () => {
  it("revision が一致すれば何も起きない", () => {
    expect(() => assertRevision({ revision: 3 }, 3)).not.toThrow();
  });

  it("revision が不一致なら競合エラーを投げる", () => {
    expect(() => assertRevision({ revision: 3 }, 2)).toThrowError("競合");
  });
});

describe("nextMeta", () => {
  it("revision をインクリメントし updatedAt に現在時刻を入れる", () => {
    const before = Date.now();
    const meta = nextMeta({ revision: 3 });
    expect(meta.revision).toBe(4);
    expect(meta.updatedAt).toBeGreaterThanOrEqual(before);
    expect(meta.updatedAt).toBeLessThanOrEqual(Date.now());
  });
});
