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

MCP プロセス側（`.mcp.json` 等）で設定する。

| 変数 | 説明 | デフォルト |
|---|---|---|
| `CONVEX_URL` | Convex デプロイ URL（`.env.local` から自動ロード） | 必須 |
| `MCP_ACCESS_TOKEN` | 全 Convex 呼び出しに同梱する共有シークレット。Convex 側の `MCP_ACCESS_TOKEN` と同じ値を設定する（未設定・空なら起動時に拒否） | 必須 |
| `MCP_AGENT_NAME` | エージェント Member の表示名 | `AI Agent` |

エージェントの email（`MCP_AGENT_EMAIL`）は Convex デプロイメント側の環境変数に
移行した。MCP プロセスからは送信しない（env 書き換えで他人の Member になりすませる
抜け道を作らないため。設定はサーバー管理者のみが持つ Convex 側の権限で行う）。

```sh
bunx convex env set MCP_AGENT_EMAIL agent@example.com        # dev
bunx convex env set MCP_AGENT_EMAIL agent@example.com --prod # prod
bunx convex env set MCP_ACCESS_TOKEN <shared-secret>          # dev
bunx convex env set MCP_ACCESS_TOKEN <shared-secret> --prod   # prod
```

MCP サーバーは起動時に `members.ensureAgent` を呼び、`MCP_AGENT_EMAIL` に対応する
Member を解決・登録する（初回は自動作成、以降は既存 Member を再利用）。

### 注意

- `accessToken` は Convex の関数引数として渡るため、Convex ダッシュボードの
  関数ログに残りうる（dev 用途の割り切り）。漏えいした場合は
  `MCP_ACCESS_TOKEN` を再設定すれば、古い値を使う全クライアントを同時に失効できる。
- Convex ダッシュボードから手動で関数を叩く場合も、他の引数と同様に
  `accessToken` を渡す必要がある（省略するとブラウザ経路として扱われ、
  Convex Auth のセッションが無ければ拒否される）。

## 起動

```sh
bun run mcp
```

Claude Code からはプロジェクトルートの `.mcp.json` で自動起動される。
