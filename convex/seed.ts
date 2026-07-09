import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { rankBetween } from "./lib/rank";

/**
 * 開発用シードユーティリティ（internalMutation のためクライアントからは呼べない）。
 * `bunx convex run seed:reset` / `seed:demo` で CLI から実行する。本番では使わない。
 */

const TABLES = [
  "gitLinks",
  "tasks",
  "issues",
  "repositories",
  "webhookDeliveries",
  "projects",
  "members",
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
  ): Promise<{ status: "created" | "skipped"; message: string }> => {
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

    const member = await ctx.db.insert("members", {
      name: "テスト太郎",
      email: "taro@example.com",
      role: "admin",
    });
    const project = await ctx.db.insert("projects", {
      key: DEMO_PROJECT_KEY,
      name: "検証用プロジェクト",
      nextTaskNumber: 1,
      nextIssueNumber: 1,
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
    };
  },
});
