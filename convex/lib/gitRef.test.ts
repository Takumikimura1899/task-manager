import { describe, expect, it } from "vitest";
import { extractTaskRef, extractTaskRefsFromCommit } from "./gitRef";

describe("Git タスク参照の抽出", () => {
  describe("extractTaskRef（ブランチ名・PR本文）", () => {
    it.each([
      { text: "feature/TASK-123-add-login", key: "TASK", number: 123 },
      { text: "TASK-1", key: "TASK", number: 1 },
      { text: "bugfix/PROJ-45", key: "PROJ", number: 45 },
      { text: "fixes TASK-9 in the PR body", key: "TASK", number: 9 },
    ])("$text から $key-$number を抽出する", ({ text, key, number }) => {
      expect(extractTaskRef(text)).toEqual({ key, number });
    });

    it.each([
      { text: "main" },
      { text: "no-ref-here" },
      { text: "task-1" }, // 小文字キーは対象外
      { text: "release/v2" },
    ])("$text からは抽出しない（null）", ({ text }) => {
      expect(extractTaskRef(text)).toBeNull();
    });
  });

  describe("extractTaskRefsFromCommit（[KEY-番号] 規約）", () => {
    it("先頭の参照を抽出する", () => {
      expect(extractTaskRefsFromCommit("[TASK-123] バグ修正")).toEqual([
        { key: "TASK", number: 123 },
      ]);
    });

    it("末尾の参照を抽出する", () => {
      expect(extractTaskRefsFromCommit("バグ修正 [TASK-123]")).toEqual([
        { key: "TASK", number: 123 },
      ]);
    });

    it("複数の参照を抽出する", () => {
      expect(extractTaskRefsFromCommit("[TASK-1] と [TASK-2] を実装")).toEqual([
        { key: "TASK", number: 1 },
        { key: "TASK", number: 2 },
      ]);
    });

    it("重複は排除する", () => {
      expect(extractTaskRefsFromCommit("[TASK-1] 修正、再度 [TASK-1]")).toEqual(
        [{ key: "TASK", number: 1 }],
      );
    });

    it.each([
      { message: "括弧なし TASK-123 は対象外" },
      { message: "参照なしのコミット" },
    ])("$message からは抽出しない（空配列）", ({ message }) => {
      expect(extractTaskRefsFromCommit(message)).toEqual([]);
    });
  });
});
