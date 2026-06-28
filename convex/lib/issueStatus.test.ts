import { describe, expect, it } from "vitest";
import { deriveIssueStatus } from "./issueStatus";

/**
 * Issue 派生ステータス算出（純粋関数・§5.1）の振る舞いを検証する。
 * 「着手されているか」を含む各区分への分類を境界ごとに確認する。
 */
describe("deriveIssueStatus", () => {
  it("active が全て backlog/todo なら open（未着手）", () => {
    expect(deriveIssueStatus(["backlog", "todo"])).toBe("open");
  });

  it("active に進行中/レビュー中が1つでもあれば in_progress（着手中）", () => {
    expect(deriveIssueStatus(["todo", "in_progress"])).toBe("in_progress");
    expect(deriveIssueStatus(["backlog", "in_review"])).toBe("in_progress");
  });

  it("一部だけ done でも未完了の active があれば in_progress", () => {
    expect(deriveIssueStatus(["done", "todo"])).toBe("in_progress");
  });

  it("active が全て done なら done", () => {
    expect(deriveIssueStatus(["done", "done"])).toBe("done");
  });

  it("canceled は集計から除外する（done と canceled の混在は done）", () => {
    expect(deriveIssueStatus(["done", "canceled"])).toBe("done");
  });

  it("全て canceled なら canceled（中止）", () => {
    expect(deriveIssueStatus(["canceled", "canceled"])).toBe("canceled");
  });
});
