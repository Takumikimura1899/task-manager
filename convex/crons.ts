import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * 定期実行ジョブの登録（技術スタック定義書 §6 / Issue #33）。
 *
 * Webhook reconcile: GitHub Webhook には到達保証がないため、定期的に GitHub API
 * をポーリングして取りこぼしを補正する（基本設計書リスク#5）。
 *
 * 実行間隔 30 分の根拠（設計書 §12.4 では未確定だったため、ここで決める）:
 * - Webhook が正常に届いている限り reconcile は差分ゼロの確認に過ぎず、
 *   取りこぼし時の検出遅延の上限（最大30分）として許容できる値。
 * - API 消費はリポジトリごとに 2 リクエスト/回（commits + pulls）で、
 *   認証済みレート制限（5,000 req/h）に対して十分小さい。
 * - ポーリングウィンドウは間隔の2倍（reconcile.RECONCILE_LOOKBACK_MS = 60分）
 *   にとり、1回の実行失敗までは次回実行でカバーされる。
 */
const crons = cronJobs();

crons.interval(
  "webhook reconcile",
  { minutes: 30 },
  internal.reconcile.run,
  {},
);

export default crons;
