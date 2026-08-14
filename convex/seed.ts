import { createAccount } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id, TableNames } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { issueInviteToken } from "./lib/crypto";
import { findMemberByEmail } from "./lib/members";
import {
  isPasswordLengthValid,
  MIN_PASSWORD_LENGTH,
} from "./lib/passwordPolicy";
import { rankBetween } from "./lib/rank";
import schema from "./schema";

/**
 * 開発用シードユーティリティ（internalMutation のためクライアントからは呼べない）。
 * `bunx convex run seed:reset` / `seed:demo` で CLI から実行する。本番では使わない。
 */

/**
 * 全テーブル（schema.tables から導出）。手動でテーブル名を列挙するミラーだと、
 * schema にテーブルを追加した際 reset 対象から漏れて孤児データが残り得るため、
 * 唯一の情報源である schema から機械的に導出する。
 *
 * Convex Auth のテーブル群（authAccounts 等）も schema（authTables）に定義されて
 * いるため自動的に含まれる: members と users のリンク（authUserId）を消す以上、
 * 認証側も残すと孤児アカウント・孤児セッションになるため、reset は認証状態ごと
 * 作り直す（ローカル開発専用の前提。seed:demoAuth でログイン可能な状態に戻せる）。
 */
const TABLES = Object.keys(schema.tables) as TableNames[];

/**
 * 全テーブルを空にする（ローカル開発の作り直し用）。
 *
 * 許容リスク: 各テーブルを `.collect()` で無制限に読み取るため、長期稼働した
 * dev デプロイでドキュメント数がトランザクション上限に達すると reset 自体が
 * 失敗し得る（dev 専用ユーティリティのため、バッチ分割・スケジューラ継続などの
 * 大掛かりな作り直しはここでは行わない）。上限超過で失敗する場合は Convex
 * dashboard から該当テーブルを削除すること。
 */
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
 *
 * デモ email の重複ガード: プロジェクトキーのチェックとは独立に、デモ member
 * （taro@example.com）が既に存在する場合は新規 insert せず再利用する。ブートストラップ
 * サインアップ（convex/lib/memberLink.ts）で先に taro@example.com が admin として
 * 自己登録された後に seed:demo を実行するケースで、プロジェクトキーは未使用のため
 * ここに到達し、無対策だと同一 email の member が2件生まれ by_email の
 * `.unique()` を使う全経路（findMemberByEmail 等）が壊れる。
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

    // 既存のデモ member（ブートストラップサインアップ等）があれば再利用し、
    // なければ members.create と同じ招待トークン方式で新規発行する
    // （convex/lib/memberLink.ts の照合が inviteTokenHash の存在を必須にするため、
    // 未設定だとサインアップ不能で詰む）。平文は返り値で一度だけ返す
    // （dev 専用 seed のため CLI 出力で確認する運用。再利用時は発行しない）。
    const existingMember = await findMemberByEmail(ctx, DEMO_MEMBER_EMAIL);
    let member: Id<"members">;
    let inviteToken: string | undefined;
    if (existingMember !== null) {
      member = existingMember._id;
    } else {
      const issued = await issueInviteToken();
      inviteToken = issued.inviteToken;
      member = await ctx.db.insert("members", {
        name: "テスト太郎",
        email: DEMO_MEMBER_EMAIL,
        role: "admin",
        inviteTokenHash: issued.inviteTokenHash,
      });
    }
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
      // taro@example.com のサインアップ用招待コード（dev 専用）。
      // 既存のデモ member を再利用したときは新規発行しないため含めない。
      ...(inviteToken !== undefined ? { inviteToken } : {}),
    };
  },
});

/** prepareDemoAuth の返り値の型（同一ファイル内 runMutation の型注釈にも使う）。 */
type PrepareDemoAuthResult =
  | { status: "ready"; inviteToken: string }
  | { status: "linked" };

/**
 * seed:demoAuth の準備（mutation 部）: デモ member の招待トークンを（再）発行する。
 * demoAuth（action）から呼ばれる。既にリンク済みなら発行しない。
 *
 * ダングリングリンク対策（指摘10）: member.authUserId が設定済みでも、参照先の
 * users doc が実在しない場合（例: 手動削除や過去の作り直しの取り残し）は
 * 未リンク扱いにする。authUserId を残したまま "linked" を返すと、signIn 不能な
 * member が永久に seed:demoAuth で救済できなくなる。
 */
export const prepareDemoAuth = internalMutation({
  args: {},
  handler: async (ctx): Promise<PrepareDemoAuthResult> => {
    const member = await findMemberByEmail(ctx, DEMO_MEMBER_EMAIL);
    if (member === null) {
      throw new ConvexError(
        `デモ member（${DEMO_MEMBER_EMAIL}）が存在しません。先に seed:demo を実行してください`,
      );
    }
    if (member.authUserId !== undefined) {
      const linkedUser = await ctx.db.get(member.authUserId);
      if (linkedUser !== null) {
        return { status: "linked" };
      }
      console.warn(
        `デモ member（${DEMO_MEMBER_EMAIL}）の authUserId (${member.authUserId}) に対応する users doc が存在しません（ダングリングリンク）。未リンク扱いにして招待トークンを再発行します`,
      );
    }
    const { inviteToken, inviteTokenHash } = await issueInviteToken();
    await ctx.db.patch(member._id, {
      inviteTokenHash,
      authUserId: undefined, // ダングリングリンクだった場合はここでクリアする
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
 *
 * 許容リスク（指摘2・トークンローテーションの非原子性）: prepareDemoAuth
 * （mutation）でトークンをローテーションした直後に、このあとの createAccount
 * （別トランザクションの action 呼び出し）が失敗すると、旧トークンは既に失効
 * 済みで新トークンの平文もこの呼び出しのメモリ上にしかない。mutation と action は
 * 別トランザクションのため両者を1つの原子操作にはできない（action からの
 * ctx.runMutation はサブトランザクションであり、失敗時に mutation 側の commit まで
 * 巻き戻すことはできない）。dev 専用ユーティリティにこれ以上の仕組みを足すのは
 * 過剰なため、復旧手段の提示に留める: 失敗時は本 action を再実行するか
 * （prepareDemoAuth が新トークンを再発行する）、seed:reset からやり直すこと。
 */
export const demoAuth = internalAction({
  args: { password: v.string() },
  handler: async (
    ctx,
    { password },
  ): Promise<{ status: "created" | "skipped"; message: string }> => {
    // UI（SignIn.tsx の MIN_PASSWORD_LENGTH）と同じ要件をここでも強制する
    if (!isPasswordLengthValid(password)) {
      throw new ConvexError(
        `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`,
      );
    }
    const prepared: PrepareDemoAuthResult = await ctx.runMutation(
      internal.seed.prepareDemoAuth,
      {},
    );
    if (prepared.status === "linked") {
      const message = `${DEMO_MEMBER_EMAIL} は既に認証アカウントとリンク済みのためスキップしました（パスワードを変える場合は seed:reset から作り直してください）`;
      console.warn(message);
      return { status: "skipped", message };
    }

    // 指摘1: authAccounts に同一 provider/providerAccountId の行が既に残って
    // いる（過去の seed:demoAuth の部分失敗・手動操作等）と、@convex-dev/auth の
    // createAccount は upsertUserAndAccount（＝招待ゲート linkAuthUserToMember 経由の
    // member リンク）をスキップして早期 return する。無対策だと member が
    // 未リンクのまま "created" と誤報告されてしまうため、(a) createAccount 自体の
    // 例外を ConvexError へ変換し、(b) 成功後に実際にリンクされたかを再読取で
    // 検証し、未リンクなら loud に失敗させる。
    try {
      await createAccount(ctx, {
        provider: "password",
        account: { id: DEMO_MEMBER_EMAIL, secret: password },
        profile: {
          email: DEMO_MEMBER_EMAIL,
          inviteCode: prepared.inviteToken,
        },
      });
    } catch (e) {
      console.error(
        `[seed:demoAuth] ${DEMO_MEMBER_EMAIL} のアカウント作成に失敗しました:`,
        e,
      );
      throw new ConvexError(
        `${DEMO_MEMBER_EMAIL} のアカウント作成に失敗しました（既存の認証情報が壊れている可能性があります）。seed:reset で作り直してから再実行してください: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const linkedUserId: Id<"users"> | null = await ctx.runQuery(
      internal.seed.getDemoMemberAuthUserId,
      {},
    );
    if (linkedUserId === null) {
      throw new ConvexError(
        `${DEMO_MEMBER_EMAIL} のアカウント作成は完了しましたが、member のリンクが確認できませんでした（既存の authAccounts が原因の可能性があります）。seed:reset で作り直してから再実行してください。`,
      );
    }

    return {
      status: "created",
      message: `${DEMO_MEMBER_EMAIL} のログイン用アカウントを作成しました`,
    };
  },
});

/**
 * デモ member が実際に authUserId でリンクされているかを返す（指摘1の検証用）。
 * demoAuth（action）は ctx.db を持たないため、createAccount 成功後の実リンク
 * 確認をこの internalQuery 経由で行う。
 */
export const getDemoMemberAuthUserId = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"users"> | null> => {
    const member = await findMemberByEmail(ctx, DEMO_MEMBER_EMAIL);
    return member?.authUserId ?? null;
  },
});
