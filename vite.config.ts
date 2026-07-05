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
  // - src/**:   コンポーネント/純粋関数テスト用の jsdom + testing-library
  test: {
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
          name: "frontend",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          setupFiles: ["./test/vitest.setup.ts"],
        },
      },
    ],
  },
});
