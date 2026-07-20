import { describe, expect, it } from "vitest";
import {
  assertHours,
  extractInviteCodeParam,
  isValidEmail,
  isValidHours,
  isValidProjectKey,
  MAX_INVITE_CODE_LENGTH,
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
    it("正規トークン長(64文字)の文字列はそのまま返す", () => {
      const token = "a".repeat(64);
      expect(extractInviteCodeParam(token)).toBe(token);
    });

    it("上限ちょうど(128文字)は受理する", () => {
      const value = "b".repeat(MAX_INVITE_CODE_LENGTH);
      expect(extractInviteCodeParam(value)).toBe(value);
    });

    it("上限を超える文字列(129文字)は「招待コードが不正です」の ConvexError で拒否する", () => {
      expect(() =>
        extractInviteCodeParam("c".repeat(MAX_INVITE_CODE_LENGTH + 1)),
      ).toThrowError("招待コードが不正です");
    });

    it.each([
      { label: "未指定", value: undefined },
      { label: "null", value: null },
      { label: "数値", value: 123 },
    ])("文字列以外($label)は undefined を返す", ({ value }) => {
      expect(extractInviteCodeParam(value)).toBeUndefined();
    });
  });
});
