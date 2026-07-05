import {
  type FunctionArgs,
  type FunctionReturnType,
  httpRouter,
} from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * GitHub Webhook の受信エンドポイント（基本設計書 §7）。
 *
 * - HMAC-SHA256（X-Hub-Signature-256）でペイロードを検証する。
 * - 検証を通らないリクエスト（署名ヘッダ不正・未登録リポジトリ・署名不一致）には
 *   すべて同一の 404 応答を返す。応答の違いから remoteUrl の登録状態を列挙
 *   されることを防ぐため、区別可能な情報はログにのみ残す（Issue #18）。
 * - X-GitHub-Delivery で冪等化し、重複配信を握り潰す。ヘッダが欠落した
 *   リクエストは冪等化できないため 400 で拒否する（Issue #16）。冪等マーキングと
 *   イベント反映は webhooks.processEvent が単一トランザクションで行うため、
 *   処理失敗（500）時はマーカーが残らず、GitHub の再送で再処理される
 *   （at-least-once、Issue #12）。
 * - 解析失敗・未知参照はサイレントに隠さず、適切な HTTP ステータスとログで返す。
 */

const http = httpRouter();

/** 一定時間比較で署名を検証する（タイミング攻撃対策）。 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function verifySignature(
  secret: string,
  body: string,
  signatureHeader: string,
): Promise<boolean> {
  if (!signatureHeader.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(new TextEncoder().encode(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new Uint8Array(new TextEncoder().encode(body)),
  );
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return timingSafeEqual(`sha256=${hex}`, signatureHeader);
}

type WebhookEvent = FunctionArgs<
  typeof internal.webhooks.processEvent
>["event"];

/** GitHub のペイロードを processEvent への入力に変換する（未対応イベントは ignored）。 */
function parseWebhookEvent(
  event: string,
  payload: any,
  repo: { repositoryId: Id<"repositories">; projectId: Id<"projects"> },
): WebhookEvent {
  if (event === "create" && payload.ref_type === "branch") {
    return {
      kind: "branch_created",
      projectId: repo.projectId,
      branchName: String(payload.ref ?? ""),
    };
  }
  if (event === "push") {
    return {
      kind: "push",
      repositoryId: repo.repositoryId,
      projectId: repo.projectId,
      commits: (payload.commits ?? []).map((c: any) => ({
        message: String(c.message ?? ""),
        sha: String(c.id ?? ""),
        url: String(c.url ?? ""),
      })),
    };
  }
  if (event === "pull_request") {
    const pr = payload.pull_request ?? {};
    return {
      kind: "pull_request",
      repositoryId: repo.repositoryId,
      projectId: repo.projectId,
      action: String(payload.action ?? ""),
      merged: Boolean(pr.merged),
      draft: Boolean(pr.draft),
      number: Number(pr.number ?? 0),
      url: String(pr.html_url ?? ""),
      title: String(pr.title ?? ""),
      body: String(pr.body ?? ""),
      branch: String(pr.head?.ref ?? ""),
    };
  }
  return { kind: "ignored", name: event };
}

/** X-Hub-Signature-256 の期待形式（sha256= + HMAC-SHA256 の hex 64桁）。 */
const SIGNATURE_FORMAT = /^sha256=[0-9a-f]{64}$/;

/**
 * 未登録リポジトリの応答タイミングを署名不一致に近づけるためのダミー secret。
 * 値自体に意味はなく、これで署名が一致することはない（検証結果は常に破棄する）。
 */
const DUMMY_SECRET = "dummy-secret-for-timing-equalization";

/**
 * 検証を通らないリクエストへの同一応答（Issue #18）。
 *
 * 署名ヘッダ不正・未登録リポジトリ・署名不一致のすべてでこの応答を返し、
 * status・ボディの違いから remoteUrl の登録状態を列挙できないようにする。
 */
function unverifiedResponse(): Response {
  return new Response("not found", { status: 404 });
}

http.route({
  path: "/webhooks/github",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.text();
    const event = request.headers.get("x-github-event") ?? "";
    const delivery = request.headers.get("x-github-delivery") ?? "";
    const signature = request.headers.get("x-hub-signature-256") ?? "";

    // X-GitHub-Delivery が無いと冪等化（重複配信の検出）が働かず、同一イベントが
    // 二重処理され得るため 400 で拒否する（Issue #16）。GitHub の正規配信には
    // 必ず付与されるヘッダで、欠落は不正・非正規なリクエストとみなせる。
    if (delivery === "") {
      console.error("[webhook] X-GitHub-Delivery ヘッダ欠落");
      return new Response("missing delivery id", { status: 400 });
    }

    // 署名ヘッダの形式検査。署名は生ボディに対する HMAC のため、リポジトリ特定
    // （ペイロード中の URL が必要）より前には完結できないが、形式検査だけを
    // JSON.parse より前に行い、署名を持たないリクエストをパース前に安価に弾く。
    if (!SIGNATURE_FORMAT.test(signature)) {
      console.error(`[webhook] 署名ヘッダ不正 delivery=${delivery}`);
      return unverifiedResponse();
    }

    let payload: any;
    try {
      payload = JSON.parse(body);
    } catch {
      console.error("[webhook] JSON パース失敗");
      return new Response("invalid json", { status: 400 });
    }

    // リポジトリ特定（署名検証に secret が必要）
    const repoUrls = [
      payload?.repository?.html_url,
      payload?.repository?.clone_url,
      payload?.repository?.ssh_url,
    ].filter((u): u is string => typeof u === "string");
    let repo: FunctionReturnType<typeof internal.webhooks.findRepositoryByUrls>;
    try {
      repo = await ctx.runQuery(internal.webhooks.findRepositoryByUrls, {
        urls: repoUrls,
      });
    } catch (e) {
      // 暗号鍵（WEBHOOK_ENCRYPTION_KEY）未設定や webhookSecret の復号失敗
      // （GCM タグ検証例外）はサーバ側の構成不備。貫通させず、ログを残して
      // 500 を返し、構成の復旧後に GitHub の再送で再処理できるようにする（Issue #16）。
      console.error("[webhook] リポジトリ解決に失敗:", e);
      return new Response("processing error", { status: 500 });
    }
    if (repo === null) {
      console.error("[webhook] 未登録のリポジトリ:", repoUrls);
      // 登録済み経路と処理時間を近づけるためダミー secret で HMAC を計算する
      // （結果は使わない）。応答自体は署名不一致と同一（Issue #18）。
      await verifySignature(DUMMY_SECRET, body, signature);
      return unverifiedResponse();
    }

    // HMAC 署名検証（不一致は未登録リポジトリと同一応答。Issue #18）
    if (!(await verifySignature(repo.secret, body, signature))) {
      console.error(`[webhook] 署名検証失敗 delivery=${delivery}`);
      return unverifiedResponse();
    }

    // 冪等マーキング（X-GitHub-Delivery）とイベント反映を単一の mutation
    // （同一トランザクション）で実行する。処理が throw した場合はマーカーごと
    // ロールバックされ、GitHub の再送で再処理される（at-least-once、Issue #12）。
    try {
      const outcome = await ctx.runMutation(internal.webhooks.processEvent, {
        deliveryId: delivery,
        event: parseWebhookEvent(event, payload, repo),
      });
      if (outcome === "duplicate") {
        return new Response("duplicate", { status: 200 });
      }
    } catch (e) {
      console.error("[webhook] 処理エラー:", e);
      return new Response("processing error", { status: 500 });
    }

    return new Response("ok", { status: 200 });
  }),
});

export default http;
