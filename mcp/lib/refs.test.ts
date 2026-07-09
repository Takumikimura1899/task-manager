import { describe, expect, it } from "vitest";
import { isActiveStatus, parseIssueRef, parseTaskRef } from "./refs";

/**
 * MCP サーバーの純粋ロジック（参照解析・アクティブ判定）の振る舞いを検証する。
 * 対象は外部依存を持たない純粋関数のため、モックは不要。
 */
describe("MCP 参照解析", () => {
  describe("parseTaskRef — タスク参照の解析", () => {
    it.each([
      { ref: "TASK-123", key: "TASK", number: 123 },
      { ref: "ABC-1", key: "ABC", number: 1 },
      { ref: "  TASK-42  ", key: "TASK", number: 42 },
    ])(
      "$ref を {key: $key, number: $number} に分解する",
      ({ ref, key, number }) => {
        expect(parseTaskRef(ref)).toEqual({ key, number });
      },
    );

    it.each([
      { ref: "TASK#123" },
      { ref: "task-123" },
      { ref: "TASK-" },
      { ref: "TASK123" },
      { ref: "" },
      { ref: "TASK-12a" },
    ])("不正な形式 $ref は例外を投げ、正しい形式を案内する", ({ ref }) => {
      expect(() => parseTaskRef(ref)).toThrowError(
        `タスク参照の形式が不正です: "${ref}"（例: TASK-123）`,
      );
    });
  });

  describe("parseIssueRef — Issue 参照の解析", () => {
    it.each([
      { ref: "TASK#1", key: "TASK", number: 1 },
      { ref: "ABC#99", key: "ABC", number: 99 },
      { ref: "  TASK#7  ", key: "TASK", number: 7 },
    ])(
      "$ref を {key: $key, number: $number} に分解する",
      ({ ref, key, number }) => {
        expect(parseIssueRef(ref)).toEqual({ key, number });
      },
    );

    it.each([
      { ref: "TASK-1" },
      { ref: "task#1" },
      { ref: "TASK#" },
      { ref: "" },
      { ref: "TASK#1a" },
    ])("不正な形式 $ref は例外を投げ、正しい形式を案内する", ({ ref }) => {
      expect(() => parseIssueRef(ref)).toThrowError(
        `Issue 参照の形式が不正です: "${ref}"（例: TASK#1）`,
      );
    });
  });

  describe("isActiveStatus — アクティブ判定", () => {
    it.each([
      { status: "backlog", expected: true },
      { status: "todo", expected: true },
      { status: "in_progress", expected: true },
      { status: "in_review", expected: true },
      { status: "open", expected: true },
      { status: "done", expected: false },
      { status: "canceled", expected: false },
    ] as const)("$status は active=$expected", ({ status, expected }) => {
      expect(isActiveStatus(status)).toBe(expected);
    });
  });
});
