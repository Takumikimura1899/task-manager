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

/**
 * 新モデル（Project→Issue→Task）でデモデータを投入する。
 * Issue ごとに最初の Task を作り、追加 Task を足して派生ステータスを観察できるようにする。
 */
export const demo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const member = await ctx.db.insert("members", {
      name: "テスト太郎",
      email: "taro@example.com",
      role: "admin",
    });
    const project = await ctx.db.insert("projects", {
      key: "TASK",
      name: "検証用プロジェクト",
      nextTaskNumber: 1,
      nextIssueNumber: 1,
    });

    // Issue とその配下 Task をまとめて作る小さなヘルパー。
    let issueNo = 1;
    let taskNo = 1;
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
        taskIds.push(
          await ctx.db.insert("tasks", {
            issue,
            project,
            number: taskNo++,
            title: t,
            status: "backlog",
            priority: "none",
            rank: rankBetween(null, null),
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
  },
});
