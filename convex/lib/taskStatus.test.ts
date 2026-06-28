import { describe, expect, it } from "vitest";
import {
  TASK_STATUSES,
  allowedTransitions,
  canTransition,
  requiresApproval,
  type TaskStatus,
} from "./taskStatus";

/**
 * 状態機械（基本設計書 §5）の振る舞いを検証する。
 * 対象は外部依存を持たない純粋関数のため、モックは不要。
 */
describe("タスク状態機械", () => {
  describe("canTransition — 許可される遷移", () => {
    it.each([
      // 前進（隣接1ステップ）
      { from: "backlog", to: "todo" },
      { from: "todo", to: "in_progress" },
      { from: "in_progress", to: "in_review" },
      { from: "in_review", to: "done" },
      // 差し戻し
      { from: "in_review", to: "in_progress" },
      // 任意のアクティブ状態 → canceled（破壊的遷移）
      { from: "backlog", to: "canceled" },
      { from: "todo", to: "canceled" },
      { from: "in_progress", to: "canceled" },
      { from: "in_review", to: "canceled" },
    ] satisfies { from: TaskStatus; to: TaskStatus }[])(
      "$from → $to を許可する",
      ({ from, to }) => {
        expect(canTransition(from, to)).toBe(true);
      },
    );
  });

  describe("canTransition — 拒否される遷移", () => {
    it.each([
      // スキップ前進（規律維持のため不可）
      { from: "backlog", to: "in_progress" },
      { from: "backlog", to: "done" },
      { from: "todo", to: "in_review" },
      { from: "in_progress", to: "done" },
      // 不正な逆行（差し戻し in_review→in_progress 以外）
      { from: "todo", to: "backlog" },
      { from: "in_progress", to: "todo" },
      { from: "in_progress", to: "backlog" },
      { from: "in_review", to: "todo" },
      // 終端状態からの遷移
      { from: "done", to: "in_progress" },
      { from: "done", to: "canceled" },
      { from: "canceled", to: "todo" },
      { from: "canceled", to: "in_progress" },
    ] satisfies { from: TaskStatus; to: TaskStatus }[])(
      "$from → $to を拒否する",
      ({ from, to }) => {
        expect(canTransition(from, to)).toBe(false);
      },
    );

    it.each(TASK_STATUSES.map((status) => ({ status })))(
      "同一状態への遷移 $status → $status を拒否する",
      ({ status }) => {
        expect(canTransition(status, status)).toBe(false);
      },
    );
  });

  describe("requiresApproval — Human-in-the-Loop 承認の要否", () => {
    it.each([
      { to: "done", expected: true },
      { to: "canceled", expected: true },
      { to: "backlog", expected: false },
      { to: "todo", expected: false },
      { to: "in_progress", expected: false },
      { to: "in_review", expected: false },
    ] satisfies { to: TaskStatus; expected: boolean }[])(
      "$to への遷移の承認要否は $expected",
      ({ to, expected }) => {
        expect(requiresApproval(to)).toBe(expected);
      },
    );
  });

  describe("allowedTransitions — 遷移可能な次状態の集合", () => {
    it.each([
      { from: "backlog", expected: ["todo", "canceled"] },
      { from: "todo", expected: ["in_progress", "canceled"] },
      { from: "in_progress", expected: ["in_review", "canceled"] },
      { from: "in_review", expected: ["done", "in_progress", "canceled"] },
      { from: "done", expected: [] },
      { from: "canceled", expected: [] },
    ] satisfies { from: TaskStatus; expected: TaskStatus[] }[])(
      "$from の遷移先一覧を返す",
      ({ from, expected }) => {
        expect(allowedTransitions(from)).toEqual(expected);
      },
    );
  });
});
