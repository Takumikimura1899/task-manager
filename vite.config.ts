import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// フロントエンド（SPA）のビルド設定。Convex 関数(convex/)とは独立。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  // Vitest 実行環境の分離（environmentMatchGlobs は v4 で廃止のため projects を使用）:
  // - convex/**: convex-test 用の edge-runtime（各ファイル冒頭の
  //   `@vitest-environment edge-runtime` docblock とも一致）
  // - mcp/**:   MCP サーバーの純粋ロジック用の node
  // - src/**:   コンポーネント/純粋関数テスト用の jsdom + testing-library
  test: {
    // カバレッジ設定は projects 構成ではルートレベルにのみ置ける
    // （Vitest 4: ルートの coverage 設定が全プロジェクトに適用される）
    coverage: {
      provider: "v8",
      // テスト対象の実装コードのみ計測（生成コード・テスト・型定義は除外）。
      // 拡張子で絞らないと convex/tsconfig.json 等の非ソースまで拾われる。
      include: ["convex/**/*.ts", "mcp/**/*.ts", "src/**/*.{ts,tsx}"],
      exclude: ["convex/_generated/**", "**/*.test.{ts,tsx}", "**/*.d.ts"],
      // CI ログでの現状把握が目的のため text レポータのみ（外部連携なし）
      reporter: ["text"],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "convex",
          environment: "edge-runtime",
          include: ["convex/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "mcp",
          environment: "node",
          include: ["mcp/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "frontend",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          setupFiles: ["./test/vitest.setup.ts"],
        },
      },
    ],
  },
});
