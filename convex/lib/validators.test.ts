import { describe, expect, it } from "vitest";
import {
  assertDateOrder,
  assertDateString,
  assertHours,
  extractInviteCodeParam,
  isValidDateString,
  isValidEmail,
  isValidHours,
  isValidProjectKey,
  normalizeEmail,
} from "./validators";

/**
 * 入力バリデーション・正規化（純粋関数）の振る舞いを検証する。モック不要。
 */
describe("入力バリデーション", () => {
  describe("isValidProjectKey", () => {
    it.each([
      { key: "TASK", expected: true },
      { key: "AB", expected: true }, // 下限2文字
      { key: "ABCDEFGHIJ", expected: true }, // 上限10文字
      { key: "T", expected: false }, // 1文字（短すぎ）
      { key: "ABCDEFGHIJK", expected: false }, // 11文字（長すぎ）
      { key: "task", expected: false }, // 小文字
      { key: "TASK1", expected: false }, // 数字を含む
      { key: "TA-SK", expected: false }, // 記号を含む
      { key: "TA SK", expected: false }, // 空白を含む
      { key: "", expected: false }, // 空文字
    ])("$key の妥当性は $expected", ({ key, expected }) => {
      expect(isValidProjectKey(key)).toBe(expected);
    });
  });

  describe("normalizeEmail", () => {
    it.each([
      { input: "  Foo@Bar.COM ", expected: "foo@bar.com" },
      { input: "USER@EXAMPLE.COM", expected: "user@example.com" },
      { input: "already@normal.com", expected: "already@normal.com" },
    ])("$input を $expected に正規化する", ({ input, expected }) => {
      expect(normalizeEmail(input)).toBe(expected);
    });
  });

  describe("isValidEmail", () => {
    it.each([
      { email: "a@b.com", expected: true },
      { email: "user.name@example.co.jp", expected: true },
      { email: "a@b", expected: false }, // ドメインにドットなし
      { email: "ab.com", expected: false }, // @ なし
      { email: "a b@c.com", expected: false }, // 空白を含む
      { email: "", expected: false }, // 空文字
    ])("$email の妥当性は $expected", ({ email, expected }) => {
      expect(isValidEmail(email)).toBe(expected);
    });
  });

  describe("isValidHours", () => {
    it.each([
      { n: 0, expected: true }, // 下限（0 は許容）
      { n: 8, expected: true }, // 正数
      { n: 2.5, expected: true }, // 小数
      { n: -1, expected: false }, // 負数
      { n: Number.NaN, expected: false }, // NaN
      { n: Number.POSITIVE_INFINITY, expected: false }, // Infinity
      { n: Number.NEGATIVE_INFINITY, expected: false }, // -Infinity
    ])("$n の妥当性は $expected", ({ n, expected }) => {
      expect(isValidHours(n)).toBe(expected);
    });
  });

  describe("assertHours", () => {
    it.each([
      { value: undefined }, // 未指定は素通し
      { value: null }, // クリアは素通し
      { value: 0 },
      { value: 8 },
    ])("$value のときは何も起きない", ({ value }) => {
      expect(() => assertHours("見積工数", value)).not.toThrow();
    });

    it.each([
      { label: "見積工数", value: -1 },
      { label: "実績工数", value: Number.NaN },
    ])(
      "$label が不正な値（$value）なら「$label は0以上の数値で」という ConvexError を投げる",
      ({ label, value }) => {
        expect(() => assertHours(label, value)).toThrowError(
          `${label}は 0 以上の数値で指定してください`,
        );
      },
    );
  });

  describe("extractInviteCodeParam", () => {
    it("正規形(64文字の小文字16進数)の文字列はそのまま返す", () => {
      const token = "0123456789abcdef".repeat(4);
      expect(extractInviteCodeParam(token)).toBe(token);
    });

    it("前後空白は除去してから受理する(copy&paste 混入対策)", () => {
      const token = "a".repeat(64);
      expect(extractInviteCodeParam(`  ${token}\n`)).toBe(token);
    });

    it.each([
      { label: "63文字", value: "a".repeat(63) },
      { label: "65文字", value: "a".repeat(65) },
      { label: "16進数以外の文字を含む64文字", value: `g${"a".repeat(63)}` },
      { label: "大文字16進数", value: "A".repeat(64) },
      { label: "巨大文字列", value: "c".repeat(10_000) },
    ])(
      "正規形でない文字列($label)は「招待コードが不正です」の ConvexError で拒否する",
      ({ value }) => {
        expect(() => extractInviteCodeParam(value)).toThrowError(
          "招待コードが不正です",
        );
      },
    );

    it.each([
      { label: "未指定", value: undefined },
      { label: "null", value: null },
      { label: "数値", value: 123 },
      { label: "空文字", value: "" }, // UI の「空欄はキー自体を送らない」と同じ未提示扱い
      { label: "空白のみ", value: "   " },
    ])("未提示相当($label)は undefined を返す", ({ value }) => {
      expect(extractInviteCodeParam(value)).toBeUndefined();
    });
  });

  describe("isValidDateString", () => {
    it.each([
      { value: "2026-08-02", expected: true },
      { value: "2024-02-29", expected: true }, // うるう年の2/29
      { value: "2026-2-3", expected: false }, // ゼロ埋めなし
      { value: "2026/02/03", expected: false }, // 区切り文字が不正
      { value: "2026-02-30", expected: false }, // 2月に30日は存在しない
      { value: "2023-02-29", expected: false }, // 非うるう年の2/29
      { value: "1999-12-31", expected: false }, // 年下限（2000年）未満
      { value: "3026-01-01", expected: false }, // 年上限（2099年）超過
      { value: "10000-01-01", expected: false }, // 年が5桁（桁あふれ）
      { value: " 2026-08-02", expected: false }, // 前方に空白
      { value: "2026-08-02 ", expected: false }, // 後方に空白
    ])("$value の妥当性は $expected", ({ value, expected }) => {
      expect(isValidDateString(value)).toBe(expected);
    });
  });

  describe("assertDateString", () => {
    it.each([
      { value: undefined }, // 未指定は素通し
      { value: null }, // クリアは素通し
    ])("$value のときは何も起きない", ({ value }) => {
      expect(() => assertDateString("開始日", value)).not.toThrow();
    });

    it.each([
      { label: "開始日", value: "2026-2-3" }, // ゼロ埋めなし
      { label: "期限日", value: "2026-02-30" }, // 非実在日
    ])(
      "$label が不正な値（$value）なら「$label は YYYY-MM-DD 形式」という ConvexError を投げる",
      ({ label, value }) => {
        expect(() => assertDateString(label, value)).toThrowError(
          `${label}は YYYY-MM-DD 形式(2000〜2099 年)の実在する日付で指定してください`,
        );
      },
    );
  });

  describe("assertDateOrder", () => {
    it("startDate と dueDate が同日なら何も起きない", () => {
      expect(() => assertDateOrder("2026-08-02", "2026-08-02")).not.toThrow();
    });

    it("startDate が dueDate より後なら ConvexError を投げる", () => {
      expect(() => assertDateOrder("2026-08-03", "2026-08-02")).toThrowError(
        "開始日は期限日以前の日付にしてください",
      );
    });

    it.each([
      {
        label: "startDate 未指定",
        startDate: undefined,
        dueDate: "2026-08-02",
      },
      { label: "dueDate 未指定", startDate: "2026-08-02", dueDate: undefined },
      { label: "両方未指定", startDate: undefined, dueDate: undefined },
    ])("$label のときは何も起きない", ({ startDate, dueDate }) => {
      expect(() => assertDateOrder(startDate, dueDate)).not.toThrow();
    });

    it("月をまたぐ順序（2026-09-30 < 2026-10-01）は正しく通る", () => {
      expect(() => assertDateOrder("2026-09-30", "2026-10-01")).not.toThrow();
    });

    it("年をまたぐ順序（2026-12-31 < 2027-01-01）は正しく通る", () => {
      expect(() => assertDateOrder("2026-12-31", "2027-01-01")).not.toThrow();
    });
  });
});
