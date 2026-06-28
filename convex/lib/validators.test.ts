import { describe, expect, it } from "vitest";
import { isValidEmail, isValidProjectKey, normalizeEmail } from "./validators";

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
});
