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
| `project://{key}` | プロジェクト概要・メンバー・アクティブ Issue 一覧（派生ステータス付き） |
| `issue://{key}/{number}` | Issue 全文（派生ステータス）＋ 配下 Task 一覧 |
| `task://{key}/{number}` | タスク全文 |
| `task://{key}/mine` | エージェントに割り当てられた未完了タスク |

### Tools（実行）

`list_issues` / `get_issue` / `create_issue` / `update_issue` / `list_tasks` /
`get_task` / `create_task` / `update_task` / `transition_status` /
`assign_task` / `delete_task` / `delete_issue` / `link_git`

- `create_issue` は最初の Task を必ず伴う（Issue は常に ≥1 Task、INVARIANT-5）。
  引数は `project_key` / `title` / `description?` / `first_task_title` / `first_task_priority?`。
- `list_tasks` は `status` / `assignee_email` に加えて `priority` でも絞り込める
  （複数指定時は AND 条件）。
- `delete_task` / `delete_issue` と `transition_status`（done/canceled 遷移）は破壊的
  操作のため**サーバー側で人間の承認を強制する**（Human-in-the-Loop, §6）。人間の承認を
  得た上で `approved: true` を指定しない限り操作は拒否される（削除系は常に、
  `transition_status` は遷移先が done / canceled の場合）。`destructiveHint` も付与
  しているため、対応ホスト（Claude Code 等）では承認プロンプトも表示される。
- `delete_issue` は配下の Task と関連 GitLink も併せて削除する（カスケード）。
- 更新系ツールの `version` 引数には `get_task` / `get_issue` で得た `revision` を渡す
  （楽観ロック）。`update_issue` は title / description / priority のみ更新可能で、
  status は子 Task 群からの派生属性のため対象外（§5.1）。
- `link_git` はタスクの所属プロジェクトからリポジトリを解決する（複数ある場合は
  `repository_url` を指定）。`(repository, type, ref)` で冪等。

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
