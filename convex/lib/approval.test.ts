import { describe, expect, it } from "vitest";
import { checkDeleteApproval, checkTransitionApproval } from "./approval";
import type { TaskStatus } from "./taskStatus";

/**
 * Human-in-the-Loop 承認ゲート（基本設計書 §6）の振る舞いを検証する。
 * 対象は外部依存を持たない純粋関数のため、モックは不要。
 */
describe("承認ゲート", () => {
  describe("checkTransitionApproval — ステータス遷移の承認判定", () => {
    it.each([
      { to: "done", approved: undefined },
      { to: "done", approved: false },
      { to: "canceled", approved: undefined },
      { to: "canceled", approved: false },
    ] satisfies { to: TaskStatus; approved: boolean | undefined }[])(
      "$to への遷移は approved: $approved なら拒否し、再実行方法を案内する",
      ({ to, approved }) => {
        const decision = checkTransitionApproval(to, approved);
        expect(decision).toMatchObject({ allowed: false });
        expect(decision).toHaveProperty(
          "reason",
          expect.stringContaining(`${to} への遷移は破壊的操作のため`),
        );
        expect(decision).toHaveProperty(
          "reason",
          expect.stringContaining("approved: true を指定して再実行"),
        );
      },
    );

    it.each([{ to: "done" }, { to: "canceled" }] satisfies {
      to: TaskStatus;
    }[])("$to への遷移は approved: true なら許可する", ({ to }) => {
      expect(checkTransitionApproval(to, true)).toEqual({ allowed: true });
    });

    it.each([
      { to: "backlog" },
      { to: "todo" },
      { to: "in_progress" },
      { to: "in_review" },
    ] satisfies { to: TaskStatus }[])(
      "非破壊的な $to への遷移は approved 無しでも許可する",
      ({ to }) => {
        expect(checkTransitionApproval(to, undefined)).toEqual({
          allowed: true,
        });
      },
    );
  });

  describe("checkDeleteApproval — タスク削除の承認判定", () => {
    it.each([{ approved: undefined }, { approved: false }] satisfies {
      approved: boolean | undefined;
    }[])(
      "approved: $approved なら常に拒否し、再実行方法を案内する",
      ({ approved }) => {
        const decision = checkDeleteApproval(approved);
        expect(decision).toMatchObject({ allowed: false });
        expect(decision).toHaveProperty(
          "reason",
          expect.stringContaining("削除は破壊的操作のため"),
        );
        expect(decision).toHaveProperty(
          "reason",
          expect.stringContaining("approved: true を指定して再実行"),
        );
      },
    );

    it("approved: true なら許可する", () => {
      expect(checkDeleteApproval(true)).toEqual({ allowed: true });
    });

    it("subject を指定すると拒否メッセージの対象名が変わる（Issue 削除）", () => {
      const decision = checkDeleteApproval(undefined, "Issue");
      expect(decision).toMatchObject({ allowed: false });
      expect(decision).toHaveProperty(
        "reason",
        expect.stringContaining("Issueの削除は破壊的操作のため"),
      );
    });

    it("subject を指定しても approved: true なら許可する", () => {
      expect(checkDeleteApproval(true, "Issue")).toEqual({ allowed: true });
    });
  });
});
