import { ConvexError } from "convex/values";

/**
 * revision（楽観ロック）まわりの共通ロジック（基本設計書 §3 INVARIANT-2）。
 * tasks / issues / webhooks で同一の競合検出・更新後処理を共有する。
 */

/** 楽観ロック（INVARIANT-2）。revision 不一致は競合として明示的に失敗させる。 */
export function assertRevision(
  doc: { revision: number },
  expectedRevision: number,
): void {
  if (doc.revision !== expectedRevision) {
    throw new ConvexError(
      "競合が発生しました。他の更新があったため最新を取得してください。",
    );
  }
}

/** 更新の共通後処理: revision をインクリメントし updatedAt を更新する。 */
export function nextMeta(doc: { revision: number }): {
  revision: number;
  updatedAt: number;
} {
  return { revision: doc.revision + 1, updatedAt: Date.now() };
}
