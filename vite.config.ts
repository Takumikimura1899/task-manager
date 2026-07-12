import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * @uiw/react-md-editor 等が JS から副作用 import するベンダー CSS を空にする。
 * そのままだとカスケードレイヤー外の CSS として注入され、@layer components の
 * 上書きが効かなくなるため、src/styles/index.css で layer(vendor) として
 * 一元 import する（フロントエンドCSS規約 参照）。
 *
 * dev では依存の事前バンドル（.vite/deps）経由になり importer が
 * node_modules を指さないため、解決対象の id 側でも判定する（dev/prod パリティ）。
 */
function stripVendorCss(): Plugin {
  const EMPTY = "\0vendor-empty-css";
  return {
    name: "strip-vendor-css",
    enforce: "pre",
    resolveId: (id, importer) =>
      id.endsWith(".css") &&
      (importer?.includes("/node_modules/@uiw/") ||
        id.includes("/node_modules/@uiw/"))
        ? EMPTY
        : undefined,
    load: (id) => (id === EMPTY ? "export {}" : undefined),
  };
}

// フロントエンド（SPA）のビルド設定。Convex 関数(convex/)とは独立。
export default defineConfig({
  plugins: [react(), stripVendorCss()],
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
