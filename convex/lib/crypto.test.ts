import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, timingSafeTokenEqual } from "./crypto";

/**
 * 対称暗号化（AES-256-GCM）・MCP アクセストークン比較の振る舞いを検証する。
 * Web Crypto API（crypto.subtle）は Node のグローバルで利用可能なためモック不要。
 */

// テスト用の固定鍵（base64 エンコードされた32バイト）
const KEY = btoa(
  String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)),
);
const OTHER_KEY = btoa(
  String.fromCharCode(...Array.from({ length: 32 }, () => 99)),
);

describe("webhookSecret の暗号化", () => {
  it("暗号化→復号で元の平文に戻る", async () => {
    const secret = "ghs_supersecret_webhook_token";
    const encrypted = await encryptSecret(secret, KEY);
    expect(await decryptSecret(encrypted, KEY)).toBe(secret);
  });

  it("暗号文は平文を含まない", async () => {
    const secret = "plain-secret-value";
    const encrypted = await encryptSecret(secret, KEY);
    expect(encrypted).not.toContain(secret);
  });

  it("同じ平文でも毎回異なる暗号文になる（IV がランダム）", async () => {
    const secret = "same-input";
    const a = await encryptSecret(secret, KEY);
    const b = await encryptSecret(secret, KEY);
    expect(a).not.toBe(b);
  });

  it("異なる鍵では復号できない", async () => {
    const encrypted = await encryptSecret("secret", KEY);
    await expect(decryptSecret(encrypted, OTHER_KEY)).rejects.toThrow();
  });

  it("改ざんされた暗号文は復号時に検出される（GCM認証タグ）", async () => {
    const encrypted = await encryptSecret("secret", KEY);
    // base64 復号 → 末尾バイトを反転 → 再エンコードで改ざんを再現
    const bytes = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
    bytes[bytes.length - 1] ^= 0xff;
    const tampered = btoa(String.fromCharCode(...bytes));
    await expect(decryptSecret(tampered, KEY)).rejects.toThrow();
  });

  it("鍵長が不正な場合はエラー", async () => {
    const shortKey = btoa("too-short");
    await expect(encryptSecret("x", shortKey)).rejects.toThrow(/32バイト/);
  });
});

describe("timingSafeTokenEqual（MCP アクセストークン比較・Issue #1 PR2）", () => {
  it("同じ文字列は一致と判定する", async () => {
    expect(await timingSafeTokenEqual("secret-token", "secret-token")).toBe(
      true,
    );
  });

  it("異なる文字列は不一致と判定する", async () => {
    expect(await timingSafeTokenEqual("secret-token", "other-token")).toBe(
      false,
    );
  });

  it("長さが異なる文字列も不一致と判定する（SHA-256 で固定長化されるため長さ差では早期 false にならない）", async () => {
    expect(await timingSafeTokenEqual("short", "much-longer-token")).toBe(
      false,
    );
  });

  it("空文字同士は一致と判定する（fail closed は呼び出し側の責務・convex/lib/auth.ts）", async () => {
    expect(await timingSafeTokenEqual("", "")).toBe(true);
  });
});
