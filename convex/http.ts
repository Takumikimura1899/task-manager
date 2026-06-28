import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * GitHub Webhook の受信エンドポイント（基本設計書 §7）。
 *
 * - HMAC-SHA256（X-Hub-Signature-256）でペイロードを検証する。
 * - X-GitHub-Delivery で冪等化し、重複配信を握り潰す。
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

http.route({
  path: "/webhooks/github",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.text();
    const event = request.headers.get("x-github-event") ?? "";
    const delivery = request.headers.get("x-github-delivery") ?? "";
    const signature = request.headers.get("x-hub-signature-256") ?? "";

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
    const repo = await ctx.runQuery(internal.webhooks.findRepositoryByUrls, {
      urls: repoUrls,
    });
    if (repo === null) {
      console.error("[webhook] 未登録のリポジトリ:", repoUrls);
      return new Response("repository not registered", { status: 404 });
    }

    // HMAC 署名検証
    if (!(await verifySignature(repo.secret, body, signature))) {
      console.error(`[webhook] 署名検証失敗 delivery=${delivery}`);
      return new Response("invalid signature", { status: 401 });
    }

    // 冪等化（リプレイ対策）
    if (delivery !== "") {
      const fresh = await ctx.runMutation(internal.webhooks.tryMarkDelivery, {
        deliveryId: delivery,
      });
      if (!fresh) {
        return new Response("duplicate", { status: 200 });
      }
    }

    // イベントディスパッチ
    try {
      if (event === "create" && payload.ref_type === "branch") {
        await ctx.runMutation(internal.webhooks.handleBranchCreated, {
          projectId: repo.projectId,
          branchName: String(payload.ref ?? ""),
        });
      } else if (event === "push") {
        const commits = (payload.commits ?? []).map((c: any) => ({
          message: String(c.message ?? ""),
          sha: String(c.id ?? ""),
          url: String(c.url ?? ""),
        }));
        await ctx.runMutation(internal.webhooks.handlePush, {
          repositoryId: repo.repositoryId,
          projectId: repo.projectId,
          commits,
        });
      } else if (event === "pull_request") {
        const pr = payload.pull_request ?? {};
        await ctx.runMutation(internal.webhooks.handlePullRequest, {
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
        });
      } else {
        console.error(`[webhook] 未対応イベント: ${event}`);
      }
    } catch (e) {
      console.error("[webhook] 処理エラー:", e);
      return new Response("processing error", { status: 500 });
    }

    return new Response("ok", { status: 200 });
  }),
});

export default http;
