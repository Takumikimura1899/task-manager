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
import {
  checkDeleteApproval,
  checkTransitionApproval,
} from "../convex/lib/approval.js";
import { TASK_STATUSES } from "../convex/lib/taskStatus.js";

const PRIORITY_VALUES = ["none", "low", "medium", "high", "urgent"] as const;
const GIT_LINK_TYPES = ["branch", "commit", "pull_request"] as const;
const PR_STATES = ["draft", "open", "merged", "closed"] as const;

const log = (...args: unknown[]) => console.error("[mcp]", ...args);

// --- Convex 接続 ------------------------------------------------------------

const convexUrl = process.env.CONVEX_URL;
if (!convexUrl) {
  log("CONVEX_URL が設定されていません（.env.local を確認してください）");
  process.exit(1);
}
const convex = new ConvexHttpClient(convexUrl);

// --- アイデンティティ（§6: MVP はエージェント専用 Member を1つ運用）---------

/** エージェントが動作する Member の email（mcp/README.md 参照）。 */
const AGENT_EMAIL = process.env.MCP_AGENT_EMAIL ?? "agent@example.com";

/** 呼び出し元エージェントに対応する Member を解決する（なければ作成）。 */
async function ensureAgentMember(): Promise<Id<"members">> {
  const name = process.env.MCP_AGENT_NAME ?? "AI Agent";
  const existing = await convex.query(api.members.getByEmail, {
    email: AGENT_EMAIL,
  });
  if (existing !== null) return existing._id;
  log(`エージェント Member を新規作成します: ${AGENT_EMAIL}`);
  return await convex.mutation(api.members.create, {
    name,
    email: AGENT_EMAIL,
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

const ISSUE_REF_PATTERN = /^([A-Z]+)#(\d+)$/;

/** "TASK#1" 形式の Issue 参照を {key, number} に分解する。 */
function parseIssueRef(ref: string): { key: string; number: number } {
  const m = ISSUE_REF_PATTERN.exec(ref.trim());
  if (m === null) {
    throw new Error(`Issue 参照の形式が不正です: "${ref}"（例: TASK#1）`);
  }
  return { key: m[1], number: Number(m[2]) };
}

async function resolveIssueId(ref: string): Promise<Id<"issues">> {
  const { key, number } = parseIssueRef(ref);
  const issue = await convex.query(api.issues.getByRef, {
    projectKey: key,
    number,
  });
  if (issue === null) throw new Error(`Issue が見つかりません: ${ref}`);
  return issue._id;
}

async function resolveMemberId(email: string): Promise<Id<"members">> {
  const member = await convex.query(api.members.getByEmail, { email });
  if (member === null) throw new Error(`メンバーが見つかりません: ${email}`);
  return member._id;
}

/**
 * タスクの所属プロジェクトからリポジトリを特定する。
 * 1つなら自動選択、複数あれば repositoryUrl で曖昧性を解消する。
 */
async function resolveRepositoryId(
  projectId: Id<"projects">,
  repositoryUrl: string | undefined,
): Promise<Id<"repositories">> {
  const repos = await convex.query(api.repositories.listByProject, {
    project: projectId,
  });
  if (repos.length === 0) {
    throw new Error("このプロジェクトにはリポジトリが登録されていません");
  }
  if (repositoryUrl !== undefined) {
    const match = repos.find((r) => r.remoteUrl === repositoryUrl);
    if (match === undefined) {
      throw new Error(`リポジトリが見つかりません: ${repositoryUrl}`);
    }
    return match._id;
  }
  if (repos.length > 1) {
    throw new Error(
      "プロジェクトに複数のリポジトリがあります。repository_url を指定してください",
    );
  }
  return repos[0]._id;
}

const isActive = (t: Doc<"tasks">) =>
  t.status !== "done" && t.status !== "canceled";

// --- サーバー構築 -----------------------------------------------------------

async function main() {
  const agentMemberId = await ensureAgentMember();

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
      if (task === null)
        throw new Error(`タスクが見つかりません: ${key}-${number}`);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(task, null, 2),
          },
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
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(mine, null, 2),
          },
        ],
      };
    },
  );

  // === Tools（実行：副作用あり）===

  server.registerTool(
    "list_tasks",
    {
      title: "タスク一覧",
      description:
        "プロジェクトのタスクを status / assignee で絞り込んで取得する",
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
        // 絞り込みはサーバー側（tasks.listFiltered）に寄せ、全件転送を避ける。
        const assignee =
          assignee_email !== undefined
            ? await resolveMemberId(assignee_email)
            : undefined;
        const tasks = await convex.query(api.tasks.listFiltered, {
          project: project._id,
          status,
          assignee,
        });
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
    "create_issue",
    {
      title: "Issue作成",
      description:
        "新しい Issue（解決すべき課題）を作成する。最初の Task を必ず伴う（Issue は常に ≥1 Task）。",
      inputSchema: {
        project_key: z.string(),
        title: z.string(),
        description: z.string().optional(),
        first_task_title: z.string().describe("Issue 解決の最初の Task"),
        first_task_priority: z.enum(PRIORITY_VALUES).optional(),
      },
    },
    async ({
      project_key,
      title,
      description,
      first_task_title,
      first_task_priority,
    }) => {
      try {
        const project = await resolveProject(project_key);
        const result = await convex.mutation(api.issues.create, {
          project: project._id,
          title,
          description,
          createdBy: agentMemberId,
          firstTask: {
            title: first_task_title,
            priority: first_task_priority,
          },
        });
        return ok({ ...result, message: "Issue を作成しました" });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_task",
    {
      title: "タスク作成",
      description:
        "既存の Issue に新しいタスクを追加する（採番・初期状態 backlog は Core 側で決定）",
      inputSchema: {
        issue_ref: z.string().describe("所属 Issue（例: TASK#1）"),
        title: z.string(),
        description: z.string().optional(),
        priority: z.enum(PRIORITY_VALUES).optional(),
        assignee_email: z.string().optional(),
      },
    },
    async ({ issue_ref, title, description, priority, assignee_email }) => {
      try {
        const issue = await resolveIssueId(issue_ref);
        const assignee =
          assignee_email !== undefined
            ? await resolveMemberId(assignee_email)
            : undefined;
        const id = await convex.mutation(api.tasks.create, {
          issue,
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
        "タスクの状態を遷移させる（状態機械で検証）。done / canceled への遷移は破壊的操作のため人間の承認が必須：ユーザーの明示的な承認を得た上で approved: true を指定すること（無ければサーバーが拒否する）。version は revision を渡す",
      inputSchema: {
        task_ref: z.string(),
        to_status: z.enum(TASK_STATUSES),
        version: z.number(),
        approved: z
          .boolean()
          .optional()
          .describe(
            "done / canceled への遷移で必須。人間の承認を得た場合のみ true を指定する",
          ),
      },
      annotations: { destructiveHint: true },
    },
    async ({ task_ref, to_status, version, approved }) => {
      try {
        const decision = checkTransitionApproval(to_status, approved);
        if (!decision.allowed) return fail(new Error(decision.reason));
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
      description:
        "タスクの担当者を設定する（assignee_email を null にすると解除）",
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
        "タスクを削除する。破壊的操作のため人間の承認が必須：ユーザーの明示的な承認を得た上で approved: true を指定すること（無ければサーバーが拒否する）。関連 GitLink も削除される。version は revision を渡す",
      inputSchema: {
        task_ref: z.string(),
        version: z.number(),
        approved: z
          .boolean()
          .optional()
          .describe("必須。人間の承認を得た場合のみ true を指定する"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ task_ref, version, approved }) => {
      try {
        const decision = checkDeleteApproval(approved);
        if (!decision.allowed) return fail(new Error(decision.reason));
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

  server.registerTool(
    "link_git",
    {
      title: "Git アーティファクト紐付け",
      description:
        "タスクに Git のブランチ/コミット/PR を紐付ける。リポジトリはタスクの所属プロジェクトから解決する（複数ある場合は repository_url を指定）。(repository, type, ref) で冪等",
      inputSchema: {
        task_ref: z.string().describe("例: TASK-123"),
        type: z.enum(GIT_LINK_TYPES),
        ref: z.string().describe("sha / PR番号 / ブランチ名"),
        url: z.string(),
        pr_state: z
          .enum(PR_STATES)
          .optional()
          .describe("type=pull_request のとき"),
        repository_url: z
          .string()
          .optional()
          .describe("プロジェクトに複数リポジトリがある場合の指定"),
      },
    },
    async ({ task_ref, type, ref, url, pr_state, repository_url }) => {
      try {
        const task = await resolveTask(task_ref);
        const repository = await resolveRepositoryId(
          task.project,
          repository_url,
        );
        const id = await convex.mutation(api.gitLinks.link, {
          task: task._id,
          repository,
          type,
          externalRef: ref,
          url,
          prState: pr_state,
        });
        return ok({ id, message: "Git アーティファクトを紐付けました" });
      } catch (e) {
        return fail(e);
      }
    },
  );

  await server.connect(new StdioServerTransport());
  log(`起動しました（agent=${AGENT_EMAIL}, convex=${convexUrl}）`);
}

main().catch((e) => {
  log("致命的エラー:", e);
  process.exit(1);
});
