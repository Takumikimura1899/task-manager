/**
 * webhookSecret の対称暗号化（基本設計書 §3「保存時は暗号化」/ §7 署名検証）。
 *
 * GitHub Webhook の HMAC-SHA256 検証には平文の secret が必要なため、復元できない
 * ハッシュではなく、可逆な AES-256-GCM で暗号化して保存し、検証時に復号する。
 * 鍵は環境変数 WEBHOOK_ENCRYPTION_KEY（base64 エンコードされた32バイト）で管理する。
 *
 * Convex ランタイム・Node いずれでも利用できる Web Crypto API（crypto.subtle）を用いる。
 * GCM の認証タグにより、保存中の改ざんは復号時に検出される。
 */

const ALGORITHM = "AES-GCM";
const IV_BYTES = 12;
const KEY_BYTES = 32; // AES-256

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

async function importKey(keyBase64: string): Promise<CryptoKey> {
  const raw = base64ToBytes(keyBase64);
  if (raw.byteLength !== KEY_BYTES) {
    throw new Error(
      "WEBHOOK_ENCRYPTION_KEY は base64 エンコードされた32バイトである必要があります",
    );
  }
  return crypto.subtle.importKey("raw", raw, ALGORITHM, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** 平文を暗号化し、iv+暗号文を base64 連結した文字列を返す。 */
export async function encryptSecret(
  plaintext: string,
  keyBase64: string,
): Promise<string> {
  const key = await importKey(keyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    new Uint8Array(new TextEncoder().encode(plaintext)),
  );

  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);
  return bytesToBase64(combined);
}

/** encryptSecret が生成した文字列を復号して平文を返す（改ざん時は例外）。 */
export async function decryptSecret(
  ciphertextB64: string,
  keyBase64: string,
): Promise<string> {
  const key = await importKey(keyBase64);
  const combined = base64ToBytes(ciphertextB64);
  const iv = combined.slice(0, IV_BYTES);
  const ciphertext = combined.slice(IV_BYTES);
  const plaintext = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(plaintext);
}
