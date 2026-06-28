# タスク管理 MCP サーバー

AI エージェント（Claude Code 等）が標準プロトコル経由でタスクを読み書きするための
MCP サーバー（基本設計書 §6・ADR-4 の MVP クサビ）。

## 設計

- **永続層に直接触らない**（§4 原則1）。`ConvexHttpClient` を介して Core ロジック
  （Convex 関数）だけを呼ぶ。状態機械・採番・楽観ロック・参照整合性などの不変条件は
  Core 側に集約されている。
- トランスポートは **stdio**。stdout は JSON-RPC 専用のため、ログは stderr に出す。

## 提供する機能

### Resources（読み取り）

| URI | 内容 |
|---|---|
| `project://{key}` | プロジェクト概要・メンバー・アクティブタスク一覧 |
| `task://{key}/{number}` | タスク全文 |
| `task://{key}/mine` | エージェントに割り当てられた未完了タスク |

### Tools（実行）

`list_tasks` / `get_task` / `create_task` / `update_task` /
`transition_status` / `assign_task` / `delete_task`

- `delete_task` と `transition_status`（done/canceled 遷移）は破壊的操作のため
  `destructiveHint` を付与。承認はホスト（Claude Code 等）が担う（Human-in-the-Loop, §6）。
- 更新系ツールの `version` 引数には `get_task` で得た `revision` を渡す（楽観ロック）。
- `link_git` は Repository / GitLink の Core API 実装後に追加予定。

## 環境変数

| 変数 | 説明 | デフォルト |
|---|---|---|
| `CONVEX_URL` | Convex デプロイ URL（`.env.local` から自動ロード） | 必須 |
| `MCP_AGENT_EMAIL` | エージェントが動作する Member の email（無ければ自動作成） | `agent@example.com` |
| `MCP_AGENT_NAME` | 同上の表示名 | `AI Agent` |

## 起動

```sh
bun run mcp
```

Claude Code からはプロジェクトルートの `.mcp.json` で自動起動される。
