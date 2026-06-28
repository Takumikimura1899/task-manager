/**
 * タスク管理 MCP サーバー（基本設計書 §6・ADR-4 の MVP クサビ）。
 *
 * 設計原則（§4 原則1）に従い、永続層には直接触らず ConvexHttpClient を介して
 * Core ロジック（Convex 関数）だけを呼ぶ。状態機械・採番・楽観ロック・参照整合性
 * といった不変条件は Core 側に集約されており、本サーバーはその公開 API を
 * MCP の Resources / Tools として AI エージェントへ橋渡しする。
 *
 * トランスポートは stdio。stdout は JSON-RPC 専用のため、ログは必ず stderr に出す。
 */
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { z } from "zod";
import { api } from "../convex/_generated/api.js";
import type { Doc, Id } from "../convex/_generated/dataModel.js";
import { TASK_STATUSES } from "../convex/lib/taskStatus.js";

const PRIORITY_VALUES = ["none", "low", "medium", "high", "urgent"] as const;

const log = (...args: unknown[]) => console.error("[mcp]", ...args);

// --- Convex 接続 ------------------------------------------------------------

const convexUrl = process.env.CONVEX_URL;
if (!convexUrl) {
  log("CONVEX_URL が設定されていません（.env.local を確認してください）");
  process.exit(1);
}
const convex = new ConvexHttpClient(convexUrl);

// --- アイデンティティ（§6: MVP はエージェント専用 Member を1つ運用）---------

/** 呼び出し元エージェントに対応する Member を解決する（なければ作成）。 */
async function ensureAgentMember(): Promise<Id<"members">> {
  const email = process.env.MCP_AGENT_EMAIL ?? "agent@example.com";
  const name = process.env.MCP_AGENT_NAME ?? "AI Agent";
  const existing = await convex.query(api.members.getByEmail, { email });
  if (existing !== null) return existing._id;
  log(`エージェント Member を新規作成します: ${email}`);
  return await convex.mutation(api.members.create, {
    name,
    email,
    role: "member",
  });
}

// --- 共通ヘルパー -----------------------------------------------------------

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const fail = (e: unknown) => {
  const message =
    e instanceof ConvexError
      ? String(e.data)
      : e instanceof Error
        ? e.message
        : String(e);
  return {
    content: [{ type: "text" as const, text: `エラー: ${message}` }],
    isError: true,
  };
};

const TASK_REF_PATTERN = /^([A-Z]+)-(\d+)$/;

/** "TASK-123" 形式の参照を {key, number} に分解する。 */
function parseTaskRef(ref: string): { key: string; number: number } {
  const m = TASK_REF_PATTERN.exec(ref.trim());
  if (m === null) {
    throw new Error(`タスク参照の形式が不正です: "${ref}"（例: TASK-123）`);
  }
  return { key: m[1], number: Number(m[2]) };
}

async function resolveTask(ref: string): Promise<Doc<"tasks">> {
  const { key, number } = parseTaskRef(ref);
  const task = await convex.query(api.tasks.getByRef, {
    projectKey: key,
    number,
  });
  if (task === null) throw new Error(`タスクが見つかりません: ${ref}`);
  return task;
}

async function resolveProject(key: string): Promise<Doc<"projects">> {
  const project = await convex.query(api.projects.getByKey, { key });
  if (project === null) throw new Error(`プロジェクトが見つかりません: ${key}`);
  return project;
}

async function resolveMemberId(email: string): Promise<Id<"members">> {
  const member = await convex.query(api.members.getByEmail, { email });
  if (member === null) throw new Error(`メンバーが見つかりません: ${email}`);
  return member._id;
}

const isActive = (t: Doc<"tasks">) =>
  t.status !== "done" && t.status !== "canceled";

// --- サーバー構築 -----------------------------------------------------------

async function main() {
  const agentMemberId = await ensureAgentMember();
  const agentEmail = process.env.MCP_AGENT_EMAIL ?? "agent@example.com";

  const server = new McpServer({ name: "task-manager", version: "0.1.0" });

  // === Resources（読み取り：LLM へ文脈を提供）===

  server.registerResource(
    "project",
    new ResourceTemplate("project://{key}", { list: undefined }),
    {
      title: "プロジェクト概要",
      description: "プロジェクトの基本情報・メンバー・アクティブタスク一覧",
      mimeType: "application/json",
    },
    async (uri, { key }) => {
      const project = await resolveProject(String(key));
      const [members, tasks] = await Promise.all([
        convex.query(api.members.list, {}),
        convex.query(api.tasks.listByProject, { project: project._id }),
      ]);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              { project, members, activeTasks: tasks.filter(isActive) },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerResource(
    "task",
    new ResourceTemplate("task://{key}/{number}", { list: undefined }),
    {
      title: "タスク詳細",
      description: "タスク全文（タイトル・説明・状態・担当・優先度）",
      mimeType: "application/json",
    },
    async (uri, { key, number }) => {
      const n = Number(number);
      if (!Number.isInteger(n)) {
        throw new Error(`タスク番号が不正です: ${String(number)}`);
      }
      const task = await convex.query(api.tasks.getByRef, {
        projectKey: String(key),
        number: n,
      });
      if (task === null) throw new Error(`タスクが見つかりません: ${key}-${number}`);
      return {
        contents: [
          { uri: uri.href, mimeType: "application/json", text: JSON.stringify(task, null, 2) },
        ],
      };
    },
  );

  server.registerResource(
    "my-tasks",
    new ResourceTemplate("task://{key}/mine", { list: undefined }),
    {
      title: "自分の未完了タスク",
      description: "呼び出し元エージェントに割り当てられた未完了タスク",
      mimeType: "application/json",
    },
    async (uri, { key }) => {
      const project = await resolveProject(String(key));
      const tasks = await convex.query(api.tasks.listByProject, {
        project: project._id,
      });
      const mine = tasks.filter(
        (t) => t.assignee === agentMemberId && isActive(t),
      );
      return {
        contents: [
          { uri: uri.href, mimeType: "application/json", text: JSON.stringify(mine, null, 2) },
        ],
      };
    },
  );

  // === Tools（実行：副作用あり）===

  server.registerTool(
    "list_tasks",
    {
      title: "タスク一覧",
      description: "プロジェクトのタスクを status / assignee で絞り込んで取得する",
      inputSchema: {
        project_key: z.string().describe("プロジェクトキー（例: TASK）"),
        status: z.enum(TASK_STATUSES).optional(),
        assignee_email: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ project_key, status, assignee_email }) => {
      try {
        const project = await resolveProject(project_key);
        let tasks = await convex.query(api.tasks.listByProject, {
          project: project._id,
        });
        if (status !== undefined) {
          tasks = tasks.filter((t) => t.status === status);
        }
        if (assignee_email !== undefined) {
          const memberId = await resolveMemberId(assignee_email);
          tasks = tasks.filter((t) => t.assignee === memberId);
        }
        return ok(tasks);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_task",
    {
      title: "タスク取得",
      description: "タスク参照（例: TASK-123）からタスク全文を取得する",
      inputSchema: { task_ref: z.string().describe("例: TASK-123") },
      annotations: { readOnlyHint: true },
    },
    async ({ task_ref }) => {
      try {
        return ok(await resolveTask(task_ref));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_task",
    {
      title: "タスク作成",
      description: "新しいタスクを作成する（採番・初期状態 backlog は Core 側で決定）",
      inputSchema: {
        project_key: z.string(),
        title: z.string(),
        description: z.string().optional(),
        priority: z.enum(PRIORITY_VALUES).optional(),
        assignee_email: z.string().optional(),
      },
    },
    async ({ project_key, title, description, priority, assignee_email }) => {
      try {
        const project = await resolveProject(project_key);
        const assignee =
          assignee_email !== undefined
            ? await resolveMemberId(assignee_email)
            : undefined;
        const id = await convex.mutation(api.tasks.create, {
          project: project._id,
          title,
          description,
          priority,
          assignee,
          createdBy: agentMemberId,
        });
        return ok({ id, message: "作成しました" });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_task",
    {
      title: "タスク更新",
      description:
        "タイトル・説明・優先度を更新する。version には get_task で得た revision を渡す（楽観ロック）",
      inputSchema: {
        task_ref: z.string(),
        version: z.number().describe("楽観ロック用 revision"),
        title: z.string().optional(),
        description: z.string().optional(),
        priority: z.enum(PRIORITY_VALUES).optional(),
      },
    },
    async ({ task_ref, version, title, description, priority }) => {
      try {
        const task = await resolveTask(task_ref);
        await convex.mutation(api.tasks.updateFields, {
          id: task._id,
          expectedRevision: version,
          title,
          description,
          priority,
        });
        return ok({ message: "更新しました" });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "transition_status",
    {
      title: "ステータス遷移",
      description:
        "タスクの状態を遷移させる（状態機械で検証）。done / canceled への遷移は破壊的操作のため承認が必要。version は revision を渡す",
      inputSchema: {
        task_ref: z.string(),
        to_status: z.enum(TASK_STATUSES),
        version: z.number(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ task_ref, to_status, version }) => {
      try {
        const task = await resolveTask(task_ref);
        await convex.mutation(api.tasks.transitionStatus, {
          id: task._id,
          to: to_status,
          expectedRevision: version,
        });
        return ok({ message: `状態を ${to_status} に変更しました` });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "assign_task",
    {
      title: "担当者割り当て",
      description: "タスクの担当者を設定する（assignee_email を null にすると解除）",
      inputSchema: {
        task_ref: z.string(),
        assignee_email: z.string().nullable(),
        version: z.number(),
      },
    },
    async ({ task_ref, assignee_email, version }) => {
      try {
        const task = await resolveTask(task_ref);
        const assignee =
          assignee_email !== null
            ? await resolveMemberId(assignee_email)
            : null;
        await convex.mutation(api.tasks.assign, {
          id: task._id,
          assignee,
          expectedRevision: version,
        });
        return ok({ message: "担当者を更新しました" });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "delete_task",
    {
      title: "タスク削除",
      description:
        "タスクを削除する（破壊的操作・要承認）。関連 GitLink も削除される。version は revision を渡す",
      inputSchema: { task_ref: z.string(), version: z.number() },
      annotations: { destructiveHint: true },
    },
    async ({ task_ref, version }) => {
      try {
        const task = await resolveTask(task_ref);
        await convex.mutation(api.tasks.deleteTask, {
          id: task._id,
          expectedRevision: version,
        });
        return ok({ message: "削除しました" });
      } catch (e) {
        return fail(e);
      }
    },
  );

  await server.connect(new StdioServerTransport());
  log(`起動しました（agent=${agentEmail}, convex=${convexUrl}）`);
}

main().catch((e) => {
  log("致命的エラー:", e);
  process.exit(1);
});
