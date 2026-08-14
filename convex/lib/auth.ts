import { getAuthUserId } from "@convex-dev/auth/server";
import {
  ConvexError,
  type ObjectType,
  type PropertyValidators,
  v,
} from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import {
  type MutationCtx,
  type QueryCtx,
  mutation,
  query,
} from "../_generated/server";
import { hasProjectPermission, type ProjectPermission } from "./authz";
import { timingSafeTokenEqual } from "./crypto";
import { findMemberByEmail } from "./members";
import { isValidEmail, normalizeEmail } from "./validators";

/**
 * 全公開関数の認証ゲート（Issue #1 PR2）。
 *
 * ゲートは2段構え:
 * - query → requireAuthed: 「誰であるか（認証済み or 正トークン）」だけを要求する。
 *   Member 未リンクでも閲覧は許可する（認証済みだが Member が消えた/未リンクの
 *   ユーザーを全画面クラッシュにせず、NoMembersNotice の案内へ落とすため。
 *   Issue #16 / #1。アクセスの完全な失効は Convex ダッシュボードで認証ユーザー
 *   自体を削除する）。
 * - mutation → requireActor: 書き込みの記録主体（actor）となる Member の解決まで
 *   要求する。未リンクは拒否。
 *
 * 呼び出し経路は2つ:
 * - MCP 経路（accessToken あり）: サーバ側の MCP_ACCESS_TOKEN と照合し、
 *   process.env.MCP_AGENT_EMAIL に紐づく member を actor として返す。
 * - ブラウザ経路（accessToken なし）: Convex Auth のセッション
 *   （getAuthUserId）から authUserId にリンクされた member を actor として返す。
 *
 * エージェントの email はクライアントから受け取らず、常に Convex 側の env
 * （MCP_AGENT_EMAIL）を単一の情報源とする。email を引数化すると、
 * 正しい accessToken さえあれば任意の email を騙って任意の member として
 * 振る舞える（本来のエージェント以外の member になりすませる）ため、
 * サーバ側でのみ解決できるようにしている。
 */

/**
 * 提示された accessToken をサーバ側の MCP_ACCESS_TOKEN と照合するだけの
 * トークン検証。member の解決は行わない（members.ensureAgent が初回起動時に
 * 呼ぶ。requireActor は member の存在を前提とするため、member 登録前の
 * 循環を避けるにはトークン検証だけを切り出す必要がある）。
 *
 * fail closed: MCP_ACCESS_TOKEN が未設定・空の場合は、たとえ accessToken も
 * 空であっても絶対に一致とみなさず拒否する。
 */
export async function requireAgentToken(
  accessToken: string | undefined,
): Promise<void> {
  const expected = process.env.MCP_ACCESS_TOKEN;
  if (expected === undefined || expected === "") {
    throw new ConvexError(
      "MCP_ACCESS_TOKEN が設定されていません（convex env set で設定してください）",
    );
  }
  if (accessToken === undefined || accessToken === "") {
    throw new ConvexError("accessToken が指定されていません");
  }
  if (!(await timingSafeTokenEqual(accessToken, expected))) {
    throw new ConvexError("accessToken が一致しません");
  }
}

/**
 * process.env.MCP_AGENT_EMAIL を検証込みで解決する（requireActor と
 * members.ensureAgent の共有ヘルパ。検証条件やメッセージの二重管理を防ぐ）。
 * 形式不正はここで即エラーにする: 黙って壊れた email の Member を作らせない
 * （CLAUDE.md「サイレント失敗の回避」）。
 */
export function requireAgentEmail(): string {
  const raw = process.env.MCP_AGENT_EMAIL;
  if (raw === undefined || raw === "") {
    throw new ConvexError(
      "MCP_AGENT_EMAIL が設定されていません（convex env set で設定してください）",
    );
  }
  const email = normalizeEmail(raw);
  if (!isValidEmail(email)) {
    throw new ConvexError(
      `MCP_AGENT_EMAIL の値がメールアドレスとして不正です: "${raw}"`,
    );
  }
  return email;
}

/**
 * authUserId にリンクされた member を解決する（requireActor と members.me の
 * 共有ヘルパ。「現在のユーザーは誰か」の解決を一箇所に集約する）。
 */
export async function findMemberByAuthUserId(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<Doc<"members"> | null> {
  return await ctx.db
    .query("members")
    .withIndex("by_authUserId", (q) => q.eq("authUserId", userId))
    .unique();
}

/**
 * ブラウザ経路の認証チェック（getAuthUserId → null なら拒否）を一箇所に
 * 集約する（requireAuthed / requireActor / requireAuthedMember で共有）。
 */
async function requireAuthUserId(ctx: QueryCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new ConvexError("認証が必要です");
  }
  return userId;
}

/**
 * query 用ゲート: 呼び出し元が「認証済みユーザー or 正トークンの MCP」で
 * あることだけを要求する（Member 未リンクでも閲覧可。冒頭コメント参照）。
 */
export async function requireAuthed(
  ctx: QueryCtx,
  accessToken?: string,
): Promise<void> {
  if (accessToken !== undefined) {
    await requireAgentToken(accessToken);
    return;
  }
  await requireAuthUserId(ctx);
}

/**
 * MCP 経路（accessToken）の member 解決（requireActor / requireViewer の
 * 共有ヘルパ。トークン照合 + MCP_AGENT_EMAIL の member 解決を一箇所に集約し、
 * 両ゲートで重複させない）。
 */
async function resolveAgentMember(
  ctx: QueryCtx,
  accessToken: string,
): Promise<Doc<"members">> {
  await requireAgentToken(accessToken);

  const agentEmail = requireAgentEmail();
  const member = await findMemberByEmail(ctx, agentEmail);
  if (member === null) {
    throw new ConvexError(
      "エージェント Member が未登録です。MCP サーバを再起動して ensureAgent を実行してください",
    );
  }
  return member;
}

/**
 * mutation 用ゲート: 呼び出し元（actor）の member を解決する。書き込みは
 * 行わない（エージェント member の初回登録は members.ensureAgent の責務）。
 */
export async function requireActor(
  ctx: QueryCtx,
  accessToken?: string,
): Promise<Doc<"members">> {
  if (accessToken !== undefined) {
    return await resolveAgentMember(ctx, accessToken);
  }

  const userId = await requireAuthUserId(ctx);
  const member = await findMemberByAuthUserId(ctx, userId);
  if (member === null) {
    throw new ConvexError("メンバー登録がありません");
  }
  return member;
}

/**
 * query 用ゲート（ブラウザ経路専用）: 認証を要求したうえで、呼び出し元に
 * リンクされた member を解決する。未リンクは throw せず null を返す
 * （requireAuthed と同じ「Member 未リンクでも閲覧は許可」方針。呼び出し側が
 * 空表示へ落とし、案内は AppLayout の NoMembersNotice が担う）。
 * accessToken（MCP 経路）は扱わない: 「自分」はブラウザセッションでしか
 * 定義できないため（MCP は list_tasks の assignee 指定で同等の絞り込みが可能）。
 */
export async function requireAuthedMember(
  ctx: QueryCtx,
): Promise<Doc<"members"> | null> {
  const userId = await requireAuthUserId(ctx);
  return await findMemberByAuthUserId(ctx, userId);
}

/**
 * query 用の主体解決（ADR-11 §3.4/§3.5 の projectQuery/projectMutation が使う
 * viewer 解決）。
 * - MCP 経路（accessToken あり）: requireActor と同一（resolveAgentMember を
 *   共有。トークン照合 + エージェント Member 解決。未登録は throw）。
 * - ブラウザ経路: requireAuthedMember と同一（認証必須。Member 未リンクは
 *   null を返す。throw しない＝「未リンクは NoMembersNotice へ落とす」既存
 *   方針の踏襲。未リンクは membership を持ち得ないため、projectQuery からは
 *   全プロジェクトが不可視になるだけで整合する）。
 */
export async function requireViewer(
  ctx: QueryCtx,
  accessToken?: string,
): Promise<Doc<"members"> | null> {
  if (accessToken !== undefined) {
    return await resolveAgentMember(ctx, accessToken);
  }
  return await requireAuthedMember(ctx);
}

/** (project, member) の membership を引く（ProjectMember の一意性が前提）。 */
export async function findMembership(
  ctx: QueryCtx,
  project: Id<"projects">,
  member: Id<"members">,
): Promise<Doc<"projectMembers"> | null> {
  return await ctx.db
    .query("projectMembers")
    .withIndex("by_project_and_member", (q) =>
      q.eq("project", project).eq("member", member),
    )
    .unique();
}

/**
 * member が参加している membership を全件列挙する（projects.list /
 * tasks.listMine が同一の by_member クエリを個別に複製していたため集約する。
 * 「参加のみ可視」・「参加プロジェクトのみに絞る」の共通の第一段）。
 */
export async function membershipsOfMember(
  ctx: QueryCtx,
  member: Id<"members">,
): Promise<Doc<"projectMembers">[]> {
  return await ctx.db
    .query("projectMembers")
    .withIndex("by_member", (q) => q.eq("member", member))
    .collect();
}

/**
 * 認証ゲートのビルダー（監査 H1）。
 *
 * 公開 query/mutation はこれまで各関数が `accessToken: v.optional(v.string())`
 * を args に手書きし、handler 冒頭で requireAuthed/requireActor を呼ぶ方式
 * だった。1関数でも呼び忘れると当該関数がインターネットに完全公開される
 * ため、ゲートを「呼ぶもの」から「関数定義の型」へ移す: authedQuery /
 * actorMutation で登録した関数は、accessToken の付与と
 * ゲート呼び出しがビルダー自身の責務になり、呼び出し忘れが構造的に起きない。
 *
 * 対象外（ゲート形が異なるため据え置き）: tasks.listMine / members.me /
 * members.ensureAgent。
 */

/** query 用ビルダー: requireAuthed を結線した query() のラッパー。 */
export function authedQuery<A extends PropertyValidators, R>(
  // accessToken はビルダーが付与する予約キー。呼び出し側の同名定義は
  // spread で無警告に上書きされるため、型レベルで衝突を拒否する
  argDefs: A & { accessToken?: never },
  handler: (
    ctx: QueryCtx,
    args: ObjectType<A> & { accessToken?: string },
  ) => Promise<R>,
) {
  return query({
    args: { ...argDefs, accessToken: v.optional(v.string()) },
    handler: async (ctx, args) => {
      await requireAuthed(ctx, args.accessToken);
      return await handler(ctx, args);
    },
  });
}

/**
 * mutation 用ビルダー: requireActor を結線し、解決した actor（member）を
 * handler の第3引数として渡す（既存呼び出し箇所の `const actor =
 * await requireActor(...)` を置き換える）。
 */
export function actorMutation<A extends PropertyValidators, R>(
  // 予約キー衝突の拒否は authedQuery と同旨
  argDefs: A & { accessToken?: never },
  handler: (
    ctx: MutationCtx,
    args: ObjectType<A> & { accessToken?: string },
    actor: Doc<"members">,
  ) => Promise<R>,
) {
  return mutation({
    args: { ...argDefs, accessToken: v.optional(v.string()) },
    handler: async (ctx, args) => {
      const actor = await requireActor(ctx, args.accessToken);
      return await handler(ctx, args, actor);
    },
  });
}

/**
 * プロジェクト単位ロールのゲート・ビルダー（ADR-11 §3.4/§3.5）。
 * authedQuery/actorMutation とは独立の新設ビルダーで、既存の2つは変更しない
 * （PR① 時点では既存公開関数に適用しない。適用は PR②）。
 *
 * query に permission 引数は無い: §3.1 の表に読み取り permission は存在せず、
 * 可視性 = membership の有無そのものだから（membership があればロール不問で
 * 閲覧可）。
 *
 * トレードオフ: membership なしを ConvexError にすると「key は存在するが
 * 非参加」を非参加者が観測できる（存在オラクル）。単一テナント・招待済み
 * メンバーのみの環境でありリスクを許容し、「認可拒否は ConvexError で明示」
 * （CLAUDE.md）を優先する（設計書 §10 で確定）。
 */

/**
 * projectQuery/projectMutation が membership 不在時に投げる ConvexError の
 * メッセージ。フロントの DetailErrorBoundary（IssueDetail/TaskDetail/
 * ProjectMembers 共通）がこの文字列と照合して DetailForbidden へ縮退させる
 * ため、投げる側と照合する側で文言を別々に持たないようここへ一元化する。
 */
export const NOT_A_MEMBER_MESSAGE = "このプロジェクトに参加していません";

/**
 * query 用ビルダー: viewer 解決 → resolveProject → membership 確認、の順で
 * ゲートし、viewer/membership を handler の第3引数として渡す。
 * - viewer が未認証: throw（requireViewer）。ブラウザ未リンク: null を返し終了。
 * - resolveProject が null（参照先が存在しない）: null を返し終了
 *   （getByKey 等の既存「見つからなければ null」契約の踏襲）。
 * - membership が無い: ConvexError（認可拒否の明示）。
 */
export function projectQuery<A extends PropertyValidators, R>(
  argDefs: A & { accessToken?: never },
  resolveProject: (
    ctx: QueryCtx,
    args: ObjectType<A>,
  ) => Promise<Id<"projects"> | null>,
  handler: (
    ctx: QueryCtx,
    args: ObjectType<A> & { accessToken?: string },
    scope: { viewer: Doc<"members">; membership: Doc<"projectMembers"> },
  ) => Promise<R>,
) {
  return query({
    args: { ...argDefs, accessToken: v.optional(v.string()) },
    handler: async (ctx, args) => {
      const viewer = await requireViewer(ctx, args.accessToken);
      if (viewer === null) return null;

      const projectId = await resolveProject(ctx, args);
      if (projectId === null) return null;

      const membership = await findMembership(ctx, projectId, viewer._id);
      if (membership === null) {
        throw new ConvexError(NOT_A_MEMBER_MESSAGE);
      }

      return await handler(ctx, args, { viewer, membership });
    },
  });
}

/**
 * mutation 用ビルダー: actor 解決 → opts.project → membership 確認 →
 * permission 判定、の順でゲートし、actor/membership を handler の第3引数
 * として渡す。
 * - actor 未リンク: throw（requireActor、既存挙動）。
 * - opts.project が null（対象が存在しない）: ConvexError
 *   （query と異なり mutation は書き込み対象の実在を要求する）。
 * - membership が無い: ConvexError。
 * - permission を持たない: ConvexError。
 */
export function projectMutation<A extends PropertyValidators, R>(
  argDefs: A & { accessToken?: never },
  opts: {
    permission: ProjectPermission;
    project: (
      ctx: QueryCtx,
      args: ObjectType<A>,
    ) => Promise<Id<"projects"> | null>;
  },
  handler: (
    ctx: MutationCtx,
    args: ObjectType<A> & { accessToken?: string },
    scope: { actor: Doc<"members">; membership: Doc<"projectMembers"> },
  ) => Promise<R>,
) {
  return mutation({
    args: { ...argDefs, accessToken: v.optional(v.string()) },
    handler: async (ctx, args) => {
      const actor = await requireActor(ctx, args.accessToken);

      const projectId = await opts.project(ctx, args);
      if (projectId === null) {
        throw new ConvexError("指定された対象が存在しません");
      }

      const membership = await findMembership(ctx, projectId, actor._id);
      if (membership === null) {
        throw new ConvexError(NOT_A_MEMBER_MESSAGE);
      }

      if (!hasProjectPermission(membership.role, opts.permission)) {
        throw new ConvexError("この操作を行う権限がありません");
      }

      return await handler(ctx, args, { actor, membership });
    },
  });
}
