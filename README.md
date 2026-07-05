# task-manager

開発チームのタスクを Git ワークフローに密結合させ、人間と AI エージェント
（Claude Code 等）が MCP を通じて対等に読み書きできる、セルフホスト型の最小
タスク管理ツール。

設計の詳細は [`docs/`](./docs) を参照（[基本設計書](./docs/基本設計書.md) /
[コンセプト](./docs/タスク管理ツールコンセプト設計.md) /
[技術スタック](./docs/技術スタック定義書.md)）。

## 技術スタック

- **永続層 / Core ロジック**: [Convex](https://convex.dev)（開発はローカルデプロイ、公開環境は Convex Cloud）
- **UI**: React + [Vite](https://vite.dev) + React Router + [dnd-kit](https://dndkit.com)（カンバン D&D）
- **ランタイム / パッケージ管理**: [Bun](https://bun.sh)
- **言語**: TypeScript
- **AI 連携**: MCP サーバー（`@modelcontextprotocol/sdk`）— [mcp/README.md](./mcp/README.md)
- **テスト**: Vitest + convex-test
- **デプロイ**: Cloudflare Workers（静的アセット配信）+ Convex Cloud — [デプロイ](#デプロイ)

## セットアップ

### 1. 依存をインストール

```sh
bun install
```

### 2. Convex ローカルデプロイを起動

```sh
bun run dev   # = npx convex dev
```

初回は Convex バックエンドのバイナリを取得し、`.env.local` に `CONVEX_URL` /
`CONVEX_SITE_URL` を書き込む。

### 3. Webhook 暗号鍵を設定（必須）

GitHub Webhook の secret を暗号化保存するための鍵（base64・32バイト）を
Convex 環境変数に設定する。**未設定だとリポジトリ登録が失敗する。**

```sh
npx convex env set WEBHOOK_ENCRYPTION_KEY "$(openssl rand -base64 32)"
```

### 4. MCP サーバー（任意）

Claude Code 等からはプロジェクトルートの `.mcp.json` で自動起動される。
手動起動は次のとおり（`CONVEX_URL` は `.env.local` から自動ロード）。

```sh
bun run mcp
```

詳細・環境変数（`MCP_AGENT_EMAIL` 等）は [mcp/README.md](./mcp/README.md)。

## 開発コマンド

| コマンド | 内容 |
|---|---|
| `bun run dev` | Convex ローカルデプロイ（watch・自動デプロイ・型生成） |
| `bun run dev:web` | Vite 開発サーバー（Web UI） |
| `bun run build` | Web UI のプロダクションビルド（`dist/`） |
| `bun run test` | Vitest（純粋ロジックのユニット＋ convex-test 結合テスト） |
| `bun run mcp` | MCP サーバー（stdio） |
| `bun run lint` | oxlint（`lint:fix` で自動修正） |
| `bun run lint:css` | stylelint（`src/**/*.css`） |
| `bun run format` | oxfmt で整形（`format:check` で検査のみ） |
| `bun run typecheck` | 型チェック（`tsc --noEmit`） |
| `bun run check` | typecheck + lint + lint:css + format:check を一括実行 |
| `bun run deploy` | 公開環境へのデプロイ（[デプロイ](#デプロイ)） |

## ディレクトリ構成

```
convex/          Core ロジック（永続層）
  schema.ts        データモデル（§3）
  projects/members/issues/tasks/repositories/gitLinks.ts   各エンティティの mutation/query
  seed.ts          開発用シードデータ（internal mutation）
  http.ts          GitHub Webhook 受信エンドポイント（§7）
  webhooks.ts      Webhook のイベント処理（internal）
  lib/             純粋ロジック（状態機械・rank・暗号化・Git参照抽出 など）
src/             Web UI（React + Vite。カンバン D&D・Issue/Task 詳細画面）
mcp/             MCP サーバー（§6）
docs/            設計書
```

## デプロイ

公開環境は **Cloudflare Workers（フロント）+ Convex Cloud（バックエンド）** で構成する。

```sh
bun run deploy   # = deploy:backend → deploy:web
```

- `deploy:backend` … `convex deploy` で Convex 本番デプロイメントへ関数をデプロイし、
  その URL（`VITE_CONVEX_URL`）を注入して `vite build` を実行する。
- `deploy:web` … `wrangler deploy` でビルド成果物 `dist/` を Cloudflare Workers の
  静的アセットとして配信する。
- SPA 配信の設定は [`wrangler.jsonc`](./wrangler.jsonc)。未知パスは `index.html` へ
  フォールバックし、React Router のディープリンク（`/:projectKey/issues/:number` 等）に対応する。
- docker-compose によるセルフホストは Phase 2 へ延期（[実装状況](#実装状況phase-1--mvp)を参照）。

## GitHub Webhook 設定

1. リポジトリを登録する（`repositories.create`）。このとき指定する
   `webhookSecret` が署名検証に使われる（保存時は AES-256-GCM で暗号化）。
2. GitHub 側で Webhook を追加する。
   - **Payload URL**: `<CONVEX_SITE_URL>/webhooks/github`
   - **Content type**: `application/json`
   - **Secret**: 上で登録した `webhookSecret` と同じ値
   - **イベント**: `push` / `pull_request` / `create`（branch）
3. commit メッセージに `[KEY-番号]`（例 `[TASK-123]`）を含めると、該当タスクに
   GitLink が紐付く。ブランチ作成・PR の open / ready / merged / closed は
   タスク状態に自動反映される（前進方向のみ・手動操作は上書きしない / §5）。

## 実装状況（Phase 1 = MVP）

- [x] データモデル（Convex schema, §3）
- [x] タスク状態機械（§5）
- [x] Project / Member / Task / Repository / GitLink の Core API（§3）
- [x] カンバン並び順（fractional-indexing による D&D 対応）
- [x] MCP サーバー（Resources 3 / Tools 9, §6）
- [x] GitHub Webhook ＋ Git 駆動の自動遷移（§7 / §5）
- [x] 最小 UI（React・一覧＋カンバン D&D・Issue/Task 詳細画面, §2）
- [ ] docker-compose によるセルフホスト（Phase 2 へ延期 / 本番化時に Convex self-hosted で対応）

> セルフホスト方針（ADR-5）は Convex セルフホスト OSS の採用で満たしている。
> docker-compose 化（本番デプロイ用）は MVP 仮説の検証に不要なため Phase 2 へ延期。
> 開発・検証はローカルの `bun run dev`（Convex ローカルデプロイ）で完結し、
> 検証用の公開環境はマネージド構成（Convex Cloud + Cloudflare Workers）で運用する
> （[デプロイ](#デプロイ)・基本設計書 ADR-5 追補）。
