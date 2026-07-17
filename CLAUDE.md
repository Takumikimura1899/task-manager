<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## プロジェクト規約

### テスト方針（Vitest）

- テストランナーは Vitest（`bun run test`）。
- Convex 関数（mutation / query）は **convex-test による結合層検証**を基本とする。
  インメモリ環境で関数を実際に実行し、観測可能な結果（返り値・DB の状態変化）で
  振る舞いを検証する（`convex/tasks.test.ts` / `convex/issues.test.ts`、
  共通ヘルパは `test/convexSupport.ts`）。
- 状態機械・rank・暗号化・Git 参照抽出などの純粋ロジックは
  `convex/lib/*.test.ts` のユニットテストで検証する。
- 詳細は技術スタック定義書 §9 を参照。

### サイレント失敗の回避

- エラー・解析失敗・未知の参照は握り潰さず、ログに残すか呼び出し元へ伝播させる
  （Webhook 処理の方針は基本設計書 §7）。

### UI 文言・配置

- UI 文言（ボタン・見出し・エラー・空状態・確認ダイアログ・aria-label・
  placeholder 等）とアクション導線（作成・削除・編集・状態遷移・「戻る」）を
  追加／変更する際は [docs/UI文言・配置規約.md](./docs/UI文言・配置規約.md) に従う。

### 設計ドキュメント

- [docs/基本設計書.md](./docs/基本設計書.md) — ADR・データモデル・状態機械・MCP 設計
- [docs/技術スタック定義書.md](./docs/技術スタック定義書.md) — 技術選定と ADR の対応・テスト・デプロイ
- [docs/フロントエンドCSS規約.md](./docs/フロントエンドCSS規約.md) — CSS 記述規約
- [docs/詳細画面設計.md](./docs/詳細画面設計.md) — Issue/Task 詳細画面の設計
- [docs/UI文言・配置規約.md](./docs/UI文言・配置規約.md) — UI 文言の用語統一・ボタン配置規約
