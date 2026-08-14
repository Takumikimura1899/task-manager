import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  actorMutation,
  findMembership,
  projectMutation,
  projectQuery,
} from "./lib/auth";
import { findMemberByEmail } from "./lib/members";
import { projectOfProjectId } from "./lib/projectScope";
import { findProjectByKey } from "./lib/projects";
import { normalizeEmail } from "./lib/validators";
import { projectRole } from "./schema";

/**
 * ProjectMember 管理 mutation 群（ADR-11 §5）。
 * INVARIANT-6（最後の owner の降格・除名・脱退拒否）を全ての離脱経路
 * （changeRole の降格 / remove / leave）で強制する。
 */

/**
 * プロジェクトの membership 全件（owner カウント・(project, member) 一意判定の
 * 共有読み取り）。
 *
 * `.collect().length` で件数を数える一般則の禁止（guidelines.md）から意図的に
 * 逸脱する: プロジェクトのメンバー数は単一テナントの規模で有界であり、
 * インデックスレンジ全体を read set に含めることが、Convex の OCC
 * （serializable）による同時実行時の重複検出（同時 leave で owner 0 名に
 * ならないこと等）の唯一の保証になる（convex/tasks.ts:100-107 の
 * rankForInsert と同じ precedent。個別 get の寄せ集めでは代替できない）。
 */
async function listProjectMembers(
  ctx: QueryCtx,
  project: Id<"projects">,
): Promise<Doc<"projectMembers">[]> {
  return await ctx.db
    .query("projectMembers")
    .withIndex("by_project_and_member", (q) => q.eq("project", project))
    .collect();
}

/**
 * INVARIANT-6: 対象 membership が owner のとき、プロジェクトの owner が
 * 対象自身の1名のみなら拒否する（降格・除名・脱退の共有ガード）。
 */
async function assertNotLastOwner(
  ctx: MutationCtx,
  project: Id<"projects">,
  target: Doc<"projectMembers">,
): Promise<void> {
  if (target.role !== "owner") return;

  const members = await listProjectMembers(ctx, project);
  const ownerCount = members.filter((m) => m.role === "owner").length;
  if (ownerCount <= 1) {
    throw new ConvexError("最後の owner は降格・除名・脱退できません");
  }
}

/** メンバー追加（owner 専用・既存 members から直接追加・§3.1 の2段階方式）。 */
export const add = projectMutation(
  { project: v.id("projects"), member: v.id("members"), role: projectRole },
  {
    permission: "project.members.manage",
    project: (ctx, args) => projectOfProjectId(ctx, args.project),
  },
  async (ctx, args) => {
    const member = await ctx.db.get(args.member);
    if (member === null) {
      throw new ConvexError("指定された Member が存在しません");
    }

    const existing = await findMembership(ctx, args.project, args.member);
    if (existing !== null) {
      throw new ConvexError("このメンバーは既にプロジェクトに参加しています");
    }

    return await ctx.db.insert("projectMembers", {
      project: args.project,
      member: args.member,
      role: args.role,
    });
  },
);

/** ロール変更（owner 専用）。owner→member 降格時は INVARIANT-6 を強制する。 */
export const changeRole = projectMutation(
  { project: v.id("projects"), member: v.id("members"), role: projectRole },
  {
    permission: "project.members.manage",
    project: (ctx, args) => projectOfProjectId(ctx, args.project),
  },
  async (ctx, args) => {
    const target = await findMembership(ctx, args.project, args.member);
    if (target === null) {
      throw new ConvexError(
        "指定されたメンバーはこのプロジェクトに参加していません",
      );
    }

    if (target.role === "owner" && args.role === "member") {
      await assertNotLastOwner(ctx, args.project, target);
    }

    await ctx.db.patch(target._id, { role: args.role });
  },
);

/** 除名（owner 専用）。自分自身の除名も可（＝脱退と同義。INVARIANT-6 が保護）。 */
export const remove = projectMutation(
  { project: v.id("projects"), member: v.id("members") },
  {
    permission: "project.members.manage",
    project: (ctx, args) => projectOfProjectId(ctx, args.project),
  },
  async (ctx, args) => {
    const target = await findMembership(ctx, args.project, args.member);
    if (target === null) {
      throw new ConvexError(
        "指定されたメンバーはこのプロジェクトに参加していません",
      );
    }

    await assertNotLastOwner(ctx, args.project, target);
    await ctx.db.delete(target._id);
  },
);

/**
 * 自主脱退（全ロール可）。permission 判定を持たないため projectMutation は
 * 使わず、actorMutation + 明示 findMembership でゲートする（membership 自体が
 * 操作対象で、handler がどのみち解決する。ビルダーに permission 省略モードは
 * 追加しない・設計書 §5 検討案6）。
 */
export const leave = actorMutation(
  { project: v.id("projects") },
  async (ctx, args, actor) => {
    const membership = await findMembership(ctx, args.project, actor._id);
    if (membership === null) {
      throw new ConvexError("このプロジェクトに参加していません");
    }

    await assertNotLastOwner(ctx, args.project, membership);
    await ctx.db.delete(membership._id);
  },
);

/** listByProject が返す1行分の shape（curated: email 等 PII は含めない）。 */
type ProjectMemberRow = {
  _id: Id<"projectMembers">;
  role: Doc<"projectMembers">["role"];
  member: { _id: Id<"members">; name: string };
};

/**
 * プロジェクトのメンバー一覧（UI のメンバー管理・ロール出し分け用）。
 * email 等 PII は返さない（members.list と同方針）。
 */
export const listByProject = projectQuery(
  { project: v.id("projects") },
  (ctx, args) => projectOfProjectId(ctx, args.project),
  async (ctx, args) => {
    const memberships = await listProjectMembers(ctx, args.project);

    // member 解決をバッチ化（convex/tasks.ts の getDetail と同じ Promise.all
    // パターン。逐次 await ループを避ける）。
    const resolved = await Promise.all(
      memberships.map(async (m): Promise<ProjectMemberRow | null> => {
        const member = await ctx.db.get(m.member);
        if (member === null) {
          // 参照整合性の異常（member が削除されているのに membership が残る）。
          // サイレントに握り潰さず、ログに残した上で当該行だけスキップする
          // （convex/tasks.ts:701-719 の既存パターン踏襲）。
          console.warn(
            `projectMembers.listByProject: member が見つかりません (${m.member})`,
          );
          return null;
        }
        return {
          _id: m._id,
          role: m.role,
          member: { _id: member._id, name: member.name },
        };
      }),
    );
    return resolved.filter((r): r is ProjectMemberRow => r !== null);
  },
);

/**
 * 運用エスケープハッチ（設計書 §10 D3）。
 *
 * PR②〜PR③ の間はアプリ内にも CLI にもメンバー追加手段が無い窓が開く
 * （公開 projectMembers.add は認証必須のため `npx convex run` から呼べない）。
 * `npx convex run projectMembers:grantProjectMembership` で1件のみ付与する
 * 唯一の運用エスケープハッチ（逆順デプロイ時の復旧経路も兼ねる）。
 * 冪等: 既存 membership があれば何もしない。
 */
export const grantProjectMembership = internalMutation({
  args: { projectKey: v.string(), email: v.string(), role: projectRole },
  handler: async (ctx, args) => {
    const project = await findProjectByKey(ctx, args.projectKey);
    if (project === null) {
      throw new ConvexError(
        `プロジェクトキー "${args.projectKey}" が見つかりません`,
      );
    }

    const email = normalizeEmail(args.email);
    const member = await findMemberByEmail(ctx, email);
    if (member === null) {
      throw new ConvexError(
        `メールアドレス "${email}" の Member が見つかりません`,
      );
    }

    const existing = await findMembership(ctx, project._id, member._id);
    if (existing !== null) {
      return { status: "already_member" as const, membershipId: existing._id };
    }

    const membershipId = await ctx.db.insert("projectMembers", {
      project: project._id,
      member: member._id,
      role: args.role,
    });
    return { status: "granted" as const, membershipId };
  },
});
