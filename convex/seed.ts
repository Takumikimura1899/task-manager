import { createAccount } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation } from "./_generated/server";
import { generateInviteToken, sha256Hex } from "./lib/crypto";
import { findMemberByEmail } from "./lib/members";
import { rankBetween } from "./lib/rank";

/**
 * 開発用シードユーティリティ（internalMutation のためクライアントからは呼べない）。
 * `bunx convex run seed:reset` / `seed:demo` で CLI から実行する。本番では使わない。
 */

const TABLES = [
  "projectMembers",
  "gitLinks",
  "tasks",
  "issues",
  "repositories",
  "webhookDeliveries",
  "projects",
  "members",
  // Convex Auth のテーブル群。members と users のリンク（authUserId）を消す以上、
  // 認証側も残すと孤児アカウント・孤児セッションになるため、reset は認証状態ごと
  // 作り直す（ローカル開発専用の前提。seed:demoAuth でログイン可能な状態に戻せる）。
  "authRefreshTokens",
  "authSessions",
  "authVerificationCodes",
  "authVerifiers",
  "authRateLimits",
  "authAccounts",
  "users",
] as const;

/** 全テーブルを空にする（ローカル開発の作り直し用）。 */
export const reset = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const table of TABLES) {
      const docs = await ctx.db.query(table).collect();
      for (const doc of docs) {
        await ctx.db.delete(doc._id);
      }
    }
  },
});

/** seed:demo が投入するデモプロジェクトのキー。 */
const DEMO_PROJECT_KEY = "TASK";

/** seed:demo が作成するデモ member のメールアドレス（seed:demoAuth と共有）。 */
const DEMO_MEMBER_EMAIL = "taro@example.com";

/**
 * 新モデル（Project→Issue→Task）でデモデータを投入する。
 * Issue ごとに最初の Task を作り、追加 Task を足して派生ステータスを観察できるようにする。
 *
 * 冪等性（#50）: 同キーのプロジェクトが既に存在する場合は投入せずスキップする。
 * `projects.create` を経由しない直接 insert のため、既存チェックを欠くと再実行で
 * key 重複が生じ、by_key への `.unique()` を使う全経路が throw する。
 * スキップ時はサイレントにせず、返り値とログで呼び出し元へ伝える。
 */
export const demo = internalMutation({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    status: "created" | "skipped";
    message: string;
    inviteToken?: string;
  }> => {
    // .unique() は（過去の重複により）2件以上あると throw するため .first() で確認する
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_key", (q) => q.eq("key", DEMO_PROJECT_KEY))
      .first();
    if (existing !== null) {
      const message = `プロジェクトキー "${DEMO_PROJECT_KEY}" は既に存在するため、seed:demo の投入をスキップしました（作り直す場合は seed:reset を先に実行してください）`;
      console.warn(message);
      return { status: "skipped", message };
    }

    // members.create と同じ招待トークン方式（convex/lib/memberLink.ts の照合が
    // inviteTokenHash の存在を必須にするため、未設定だとサインアップ不能で詰む）。
    // 平文は返り値で一度だけ返す（dev 専用 seed のため CLI 出力で確認する運用）。
    const inviteToken = generateInviteToken();
    const member = await ctx.db.insert("members", {
      name: "テスト太郎",
      email: DEMO_MEMBER_EMAIL,
      role: "admin",
      inviteTokenHash: await sha256Hex(inviteToken),
    });
    const project = await ctx.db.insert("projects", {
      key: DEMO_PROJECT_KEY,
      name: "検証用プロジェクト",
      nextTaskNumber: 1,
      nextIssueNumber: 1,
    });
    // INVARIANT-6（owner の存在）: projects.create を経由しない直接 insert
    // のため、ここで明示的に owner membership を挿入する（owner 不在
    // プロジェクトを生まない・ADR-11）。
    await ctx.db.insert("projectMembers", {
      project,
      member,
      role: "owner",
    });

    // Issue とその配下 Task をまとめて作る小さなヘルパー。
    let issueNo = 1;
    let taskNo = 1;
    // rank は列（status）内の並び順を決める。rankBetween(null, null) を毎回呼ぶと
    // 全タスクが同一 rank "a0" になり、並び順が退化し move で例外が起きるため、
    // 直前タスクの rank を before に渡して単調増加の系列を連鎖生成する。
    // （seed の全タスクは backlog 列なので、系列は1本でよい）
    let prevRank: string | null = null;
    const addIssue = async (title: string, taskTitles: string[]) => {
      const issue = await ctx.db.insert("issues", {
        project,
        number: issueNo++,
        title,
        createdBy: member,
        revision: 0,
        updatedAt: Date.now(),
      });
      const taskIds: Id<"tasks">[] = [];
      for (const t of taskTitles) {
        prevRank = rankBetween(prevRank, null);
        taskIds.push(
          await ctx.db.insert("tasks", {
            issue,
            project,
            number: taskNo++,
            title: t,
            status: "backlog",
            priority: "none",
            rank: prevRank,
            createdBy: member,
            revision: 0,
            updatedAt: Date.now(),
          }),
        );
      }
      return taskIds;
    };

    await addIssue("ログイン機能を実装する", [
      "ログイン画面の実装",
      "認証APIの実装",
    ]);
    await addIssue("APIの安定性を高める", [
      "レート制限の追加",
      "リトライ処理の実装",
    ]);

    // カウンタを実際の発番数に合わせて補正する。
    await ctx.db.patch(project, {
      nextTaskNumber: taskNo,
      nextIssueNumber: issueNo,
    });

    return {
      status: "created",
      message: `プロジェクト "${DEMO_PROJECT_KEY}" とデモデータ（Issue ${issueNo - 1}件 / Task ${taskNo - 1}件）を投入しました`,
      inviteToken, // taro@example.com のサインアップ用招待コード（dev 専用）
    };
  },
});

/**
 * seed:demoAuth の準備（mutation 部）: デモ member の招待トークンを（再）発行する。
 * demoAuth（action）から呼ばれる。既にリンク済みなら発行しない。
 */
export const prepareDemoAuth = internalMutation({
  args: {},
  handler: async (
    ctx,
  ): Promise<
    { status: "ready"; inviteToken: string } | { status: "linked" }
  > => {
    const member = await findMemberByEmail(ctx, DEMO_MEMBER_EMAIL);
    if (member === null) {
      throw new ConvexError(
        `デモ member（${DEMO_MEMBER_EMAIL}）が存在しません。先に seed:demo を実行してください`,
      );
    }
    if (member.authUserId !== undefined) {
      return { status: "linked" };
    }
    const inviteToken = generateInviteToken();
    await ctx.db.patch(member._id, {
      inviteTokenHash: await sha256Hex(inviteToken),
    });
    return { status: "ready", inviteToken };
  },
});

/**
 * デモ member（taro@example.com）のログイン用アカウントを seed で用意する（dev 専用）。
 * `bunx convex run seed:demoAuth '{"password":"<8文字以上>"}'` で実行し、以後 UI の
 * サインアップ操作なしで taro@example.com + 指定パスワードでログインできる。
 *
 * 招待ゲート（convex/lib/memberLink.ts）はバイパスしない: prepareDemoAuth が発行した
 * 招待トークンを profile.inviteCode として渡し、createAccount →
 * afterUserCreatedOrUpdated → linkAuthUserToMember という本番と同一の経路で
 * 照合・リンクさせる（seed 専用の抜け道を作らないため）。
 *
 * 冪等性: 既にリンク済みなら何もしない（パスワードを変えたい場合は seed:reset から
 * 作り直す）。
 */
export const demoAuth = internalAction({
  args: { password: v.string() },
  handler: async (
    ctx,
    { password },
  ): Promise<{ status: "created" | "skipped"; message: string }> => {
    // UI（SignIn.tsx の minLength=8）と同じ要件をここでも強制する
    if (password.length < 8) {
      throw new ConvexError("パスワードは8文字以上にしてください");
    }
    const prepared = await ctx.runMutation(internal.seed.prepareDemoAuth, {});
    if (prepared.status === "linked") {
      const message = `${DEMO_MEMBER_EMAIL} は既に認証アカウントとリンク済みのためスキップしました（パスワードを変える場合は seed:reset から作り直してください）`;
      console.warn(message);
      return { status: "skipped", message };
    }
    await createAccount(ctx, {
      provider: "password",
      account: { id: DEMO_MEMBER_EMAIL, secret: password },
      profile: {
        email: DEMO_MEMBER_EMAIL,
        inviteCode: prepared.inviteToken,
      },
    });
    return {
      status: "created",
      message: `${DEMO_MEMBER_EMAIL} のログイン用アカウントを作成しました`,
    };
  },
});
