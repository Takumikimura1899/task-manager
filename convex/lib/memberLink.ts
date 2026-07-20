import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { sha256Hex, timingSafeEqual } from "./crypto";
import { normalizeEmail } from "./validators";

/**
 * 招待コード拒否時の文言（オラクル低減）。member.inviteTokenHash が未設定の
 * ケースと inviteCode 不一致のケースを同一文言にし、レスポンスから
 * 「member は存在するがコードが違う」と「そもそも招待トークンが発行されていない」
 * を区別させない（招待ウィンドウ乗っ取り対策、gemini security-high 3611654753）。
 */
const INVITE_CODE_REJECTED_MESSAGE =
  "招待コードが確認できませんでした。管理者に招待の再発行を依頼してください。";

/**
 * inviteTokenHash 未設定 member への照合で使うダミー値（sha256 hex と同じ64文字）。
 * timingSafeEqual を常に実行し、「トークン発行済みか否か」で比較の有無という
 * タイミング差を作らないためのもの。
 */
const DUMMY_INVITE_TOKEN_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Convex Auth の users を既存 member にリンクする招待制ゲート（Issue #1 PR1・招待
 * トークン方式は #1 追補）。
 *
 * Password provider のサインアップ（convex/auth.ts の afterUserCreatedOrUpdated
 * コールバック）から呼ばれる、convex-test から直接検証できる純関数的ヘルパ。
 *
 * - メールアドレスが事前に members へ登録済み（招待済み） → members.create が
 *   発行した招待トークン（SHA-256 ハッシュを member.inviteTokenHash に保存済み）を
 *   users.inviteCode と照合し、一致した場合のみリンクする。不一致・未提示は拒否する
 *   （招待済み未サインアップ member を、同一 email の先行サインアップで第三者が
 *   横取りできてしまう「招待ウィンドウ乗っ取り」への対策）。
 * - 未登録 → ブートストラップ条件（後述）を満たす初回サインアップのみ admin として
 *   自己登録できる。それ以外は「招待されていません」で拒否し、signUp トランザクション
 *   ごとロールバックさせる（＝招待制の強制）。ブートストラップは招待トークン不要。
 */
export async function linkAuthUserToMember(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<void> {
  const user = await ctx.db.get(userId);
  if (user === null || user.email === undefined) {
    throw new ConvexError("認証ユーザーにメールアドレスが設定されていません");
  }

  // 冒頭で無条件クリア（defense-in-depth）: この関数を通る限り、リンクの成否や
  // この後の分岐に関わらず users.inviteCode は必ず除去する。照合に使う値は
  // 消す前にローカル変数へ退避しておく。将来 verify/OAuth 等の経路が追加されても
  // 平文の inviteCode が users doc に残留しないよう、経路によらず先回りで防ぐ
  // （上のガードを通った throw 経路はどのみちトランザクションごとロールバック
  // されるため、クリアより前に置いても後に置いても観測結果は変わらない。
  // ガード自体は単一箇所にまとめ、エラーメッセージの重複を避ける）。
  const inviteCode = user.inviteCode;
  if (inviteCode !== undefined) {
    await ctx.db.patch(userId, { inviteCode: undefined });
  }

  const email = normalizeEmail(user.email);

  const existing = await ctx.db
    .query("members")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique();

  if (existing !== null) {
    if (existing.authUserId === undefined) {
      // オラクル低減: inviteTokenHash の有無に関わらず常に sha256Hex と
      // timingSafeEqual の両方を通してから判定する（早期 return も短絡もしない）。
      // 分岐 (a)(b) のタイミング差を作らないため、hash 未設定時はダミー値と比較する
      // （sha256Hex がオール0の digest を返すことは事実上ないため必ず不一致になる）。
      const providedHash = await sha256Hex(inviteCode ?? "");
      const expectedHash = existing.inviteTokenHash ?? DUMMY_INVITE_TOKEN_HASH;
      const matched =
        timingSafeEqual(providedHash, expectedHash) &&
        existing.inviteTokenHash !== undefined;
      if (!matched) {
        throw new ConvexError(INVITE_CODE_REJECTED_MESSAGE);
      }
      await ctx.db.patch(existing._id, {
        authUserId: userId,
        inviteTokenHash: undefined, // 使い捨て: リンク成功時に除去する
      });
      return;
    }
    if (existing.authUserId === userId) {
      return; // 既にリンク済み（同一ユーザーの再サインインなど。冪等）
    }
    // 既に別の authUserId にリンク済みの member を横取りさせない（アカウント乗っ取り防止）。
    throw new ConvexError(
      "このメールアドレスは既に別のアカウントで登録されています。心当たりがない場合は管理者にご連絡ください。",
    );
  }

  // ブートストラップ判定: MCP エージェント用の bot アカウント（process.env.MCP_AGENT_EMAIL、
  // 未設定なら除外なし）を除いた members が 0 件のときに限り、最初のサインアップを
  // admin として自己登録できる（プロジェクト立ち上げ時に招待者が誰もいない問題の回避）。
  //
  // .collect() ではなく .take(2) で最大2件だけ読む（members が増えても無制限に
  // 読み込まない）。それでも OCC の直列化は次の理由で崩れない:
  // - take(2) が2件未満（0件・1件）を返すのは、クエリが members テーブルの終端まで
  //   走査してもなお2件に満たなかった場合に限る。このとき読み取り範囲（readset）は
  //   テーブル全域に及ぶため、並行する signUp の insert は必ず OCC 競合として検出・
  //   再試行される（点読み＝by_email の0件ヒットだと「別 email の insert」と読み取り
  //   範囲が重ならず、複数の signUp が並行に「0件」を読んでブートストラップ条件を
  //   満たし admin が複数作られてしまう。これが元々 .collect() でテーブル全体を
  //   読み取り範囲に含めていた理由）。
  // - take(2) が2件返る経路（=ブートストラップ非該当・拒否）はこの後に書き込みを
  //   行わないため、直列化は不要（OCC 保護の対象外でよい）。
  //
  // 依存する不変条件: 上記は「agent member（MCP_AGENT_EMAIL）が高々1件（by_email の
  // 一意性＋OCC で保証）」であることに依存する。先頭2件のうち高々1件が agent でも
  // 残り1件で人間の有無を判定できる、という前提。agent の重複を許す変更を将来
  // 入れる場合は、このブートストラップ判定を見直すこと。
  const agentEmail = process.env.MCP_AGENT_EMAIL
    ? normalizeEmail(process.env.MCP_AGENT_EMAIL)
    : null;
  const firstTwoMembers = await ctx.db.query("members").take(2);
  const humanMemberCount = firstTwoMembers.filter(
    (m) => m.email !== agentEmail,
  ).length;

  if (humanMemberCount === 0) {
    const localPart = email.split("@")[0] ?? email;
    await ctx.db.insert("members", {
      name: localPart,
      email,
      role: "admin",
      authUserId: userId,
    });
    return;
  }

  throw new ConvexError(
    "このメールアドレスは招待されていません。管理者にメンバー登録を依頼してください。",
  );
}
