import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * データモデル（基本設計書 §3 / Phase 1 = MVP）
 *
 * 論理モデルからの物理マッピング方針:
 * - `id`        → Convex のシステムフィールド `_id` で代替
 * - `createdAt` → Convex のシステムフィールド `_creationTime` で代替
 * - `updatedAt` は Convex が自動管理しないため、Task に明示フィールドとして保持する
 *
 * 不変条件（INVARIANT, §3）の実現機構:
 * 1. 採番の一意性 ……… Project.nextTaskNumber を mutation のトランザクション内で
 *    atomic に採番する（Convex の楽観的並行制御=OCC が同時実行の重複を検出・再試行）
 * 2. 並行更新の検出 …… Task.revision（RevisionToken）。MCP の update_task が version を
 *    取る契約（§6）に合わせ、更新条件として比較する
 * 3. 参照整合性 ……… v.id("...") による型付き参照で表現（実在性は Core ロジックで担保）
 * 4. 状態の妥当性 …… §5 の状態機械は保存層ではなく Core ロジックで強制する
 */

// §5 固定6状態（オピニオネイテッド）。遷移規則は Core ロジックの状態機械で強制する。
export const taskStatus = v.union(
  v.literal("backlog"),
  v.literal("todo"),
  v.literal("in_progress"),
  v.literal("in_review"),
  v.literal("done"),
  v.literal("canceled"),
);

export const taskPriority = v.union(
  v.literal("none"),
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("urgent"),
);

export const gitLinkType = v.union(
  v.literal("branch"),
  v.literal("commit"),
  v.literal("pull_request"),
);

// type=pull_request のときに意味を持つ
export const prState = v.union(
  v.literal("draft"),
  v.literal("open"),
  v.literal("merged"),
  v.literal("closed"),
);

export const memberRole = v.union(v.literal("admin"), v.literal("member"));

export default defineSchema({
  // Convex Auth 用テーブル（users / authAccounts / authSessions 等）
  ...authTables,

  // users は authTables のフィールド（インデックスも含め漏れなく再現。email
  // インデックスは auth 内部の実装が依存する）に、招待トークン方式（招待ウィンドウ
  // 乗っ取り対策・Issue #1）で使い捨てで受け渡す inviteCode を追加する。
  // convex/auth.ts の profile() が signUp 引数から一度だけ書き込み、
  // convex/lib/memberLink.ts の linkAuthUserToMember が照合後に必ず除去する。
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    inviteCode: v.optional(v.string()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

  // Project — 作業の単位
  projects: defineTable({
    // 短縮名（例 "TASK" → 表示は TASK-123）。一意性は Core ロジックで保証する。
    key: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    // 採番カウンタ: 次に発番する番号。採番時に atomic にインクリメントする（INVARIANT-1）。
    nextTaskNumber: v.number(),
    nextIssueNumber: v.number(),
  }).index("by_key", ["key"]),

  // Member — 人間および AI エージェントの主体（AIエージェントも role=member として表現）
  members: defineTable({
    name: v.string(),
    email: v.string(), // 一意性は Core ロジックで保証する
    role: memberRole,
    // Convex Auth の users への安定リンク（認証済みユーザー⇄Member の対応）。
    // 招待制リンク（convex/lib/memberLink.ts）で設定される。未認証運用中や
    // 招待未消化の member は unset のままでよい。
    authUserId: v.optional(v.id("users")),
    // 招待トークンの SHA-256 ハッシュ（招待ウィンドウ乗っ取り対策・Issue #1）。
    // members.create が発行時に一度だけ設定する。平文は保存しない。
    // リンク成功時（linkAuthUserToMember）に除去する使い捨ての値。
    inviteTokenHash: v.optional(v.string()),
  })
    .index("by_email", ["email"])
    .index("by_authUserId", ["authUserId"]),

  // Issue — 解決すべき課題（Task の上位概念、基本設計書 ADR-9 / §3）
  // status は保持しない派生属性（子 Task 群から算出、§5.1 / lib/issueStatus.ts）。
  issues: defineTable({
    project: v.id("projects"),
    // プロジェクト内で一意の連番（表示は {key}#{number}）
    number: v.number(),
    title: v.string(),
    description: v.optional(v.string()), // Markdown
    createdBy: v.id("members"),
    // 未設定は読み出し時に "none" へ正規化する（既存 taskPriority validator を流用）。
    priority: v.optional(taskPriority),
    revision: v.number(), // 並行更新検出（楽観ロック）
    updatedAt: v.number(),
  })
    .index("by_project", ["project"])
    // 採番の一意性チェック・{key}#{number} 解決用
    .index("by_project_and_number", ["project", "number"]),

  // Task — タスク本体（Issue を解決する手段）
  tasks: defineTable({
    // 所属 Issue（必須・INVARIANT-5）。Task は必ずいずれかの Issue に従属する。
    issue: v.id("issues"),
    // issue.project と一致させる冗長参照（ボード問い合わせ効率化。整合は Core で担保）。
    project: v.id("projects"),
    // プロジェクト内で一意の連番（表示は {key}-{number}）
    number: v.number(),
    title: v.string(),
    description: v.optional(v.string()), // Markdown
    status: taskStatus,
    priority: taskPriority,
    assignee: v.optional(v.id("members")),
    // 見積工数（単位: 時間）
    estimate: v.optional(v.number()),
    // 実績工数（単位: 時間）
    actual: v.optional(v.number()),
    // カンバン並び順（LexoRank 等の比較可能な値）
    rank: v.string(),
    createdBy: v.id("members"), // 人間／AIエージェントいずれも Member
    revision: v.number(), // 並行更新検出（楽観ロック）
    updatedAt: v.number(), // createdAt は _creationTime で代替
  })
    .index("by_project", ["project"])
    // 採番の一意性チェック・{key}-{number} 解決用
    .index("by_project_and_number", ["project", "number"])
    // カンバン列（ステータス別一覧）を rank 昇順で取得・末尾採番するため rank を含める
    .index("by_project_and_status", ["project", "status", "rank"])
    // Issue 配下の Task 一覧・派生ステータス算出・最低基数チェック用
    .index("by_issue", ["issue"])
    .index("by_assignee", ["assignee"]),

  // Repository — Git 連携先
  repositories: defineTable({
    project: v.id("projects"),
    provider: v.literal("github"),
    remoteUrl: v.string(),
    // 署名検証用の機密値。保存時の暗号化は実装層（Core ロジック）の責務。
    webhookSecret: v.string(),
  })
    .index("by_project", ["project"])
    // Webhook 受信時の remoteUrl 逆引き用（全件走査の回避・Issue #19）
    .index("by_remoteUrl", ["remoteUrl"]),

  // GitLink — タスクと Git アーティファクトの関連
  gitLinks: defineTable({
    task: v.id("tasks"),
    repository: v.id("repositories"),
    type: gitLinkType,
    externalRef: v.string(), // sha／PR番号／ブランチ名
    url: v.string(),
    prState: v.optional(prState), // type=pull_request のとき
  })
    .index("by_task", ["task"])
    .index("by_repository", ["repository"])
    // 既存リンク検索・upsert 用（task × repository × type × ref で同定・Issue #38）。
    // task を末尾に置くことで、同一 Git アーティファクトの全リンク検索
    // （repository × type × ref の前方一致）にも使える
    .index("by_ref_and_task", ["repository", "type", "externalRef", "task"]),

  // Webhook 配信の冪等化（§7: X-GitHub-Delivery で重複処理を防ぐ）
  webhookDeliveries: defineTable({
    deliveryId: v.string(),
  }).index("by_delivery", ["deliveryId"]),
});
