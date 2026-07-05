import { describe, expect, it } from "vitest";
import { extractTaskRef, extractTaskRefsFromCommit } from "./gitRef";

describe("Git タスク参照の抽出", () => {
  describe("extractTaskRef（ブランチ名・PR本文）", () => {
    it.each([
      { text: "feature/TASK-123-add-login", key: "TASK", number: 123 },
      { text: "feature/TASK-123-fix", key: "TASK", number: 123 },
      { text: "TASK-1", key: "TASK", number: 1 },
      { text: "TASK-123", key: "TASK", number: 123 },
      { text: "bugfix/PROJ-45", key: "PROJ", number: 45 },
      { text: "fixes TASK-9 in the PR body", key: "TASK", number: 9 },
      { text: "この PR は TASK-123 を解決する", key: "TASK", number: 123 },
      { text: "TASK-123を修正", key: "TASK", number: 123 }, // 和文文字は区切り扱い
    ])("$text から $key-$number を抽出する", ({ text, key, number }) => {
      expect(extractTaskRef(text)).toEqual({ key, number });
    });

    it.each([
      { text: "main" },
      { text: "no-ref-here" },
      { text: "task-1" }, // 小文字キーは対象外
      { text: "release/v2" },
      { text: "xTASK-123" }, // 直前が英数字（部分マッチ禁止）
      { text: "TASK-123abc" }, // 直後が英字
      { text: "TASK-1234x" }, // 番号の直後が英字
      { text: "sha256-TASK99" }, // ハイフンの前後が KEY-番号 形でない
    ])("$text からは抽出しない（null）", ({ text }) => {
      expect(extractTaskRef(text)).toBeNull();
    });

    describe("プロジェクトキーによる絞り込み", () => {
      it.each([
        { name: "UTF-8", text: "エンコーディングは UTF-8 とする" },
        { name: "COVID-19", text: "COVID-19 対応の在宅勤務ページ" },
        { name: "RFC-2119", text: "RFC-2119 の MUST に準拠する" },
        { name: "英数字隣接の XCOVID-19", text: "XCOVID-19" },
      ])(
        "$name のような一般的文字列はキー不一致で抽出しない（null）",
        ({ text }) => {
          expect(extractTaskRef(text, "TASK")).toBeNull();
        },
      );

      it.each([
        { text: "feature/TASK-123-fix", number: 123 },
        { text: "TASK-123", number: 123 },
        { text: "本文中の TASK-123 を参照する", number: 123 },
      ])("キー一致の $text からは抽出する", ({ text, number }) => {
        expect(extractTaskRef(text, "TASK")).toEqual({ key: "TASK", number });
      });

      it("キー不一致の参照はスキップし、後続のキー一致参照を拾う", () => {
        expect(extractTaskRef("RFC-2119 に従い TASK-9 を修正", "TASK")).toEqual(
          { key: "TASK", number: 9 },
        );
      });
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
