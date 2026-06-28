import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// フロントエンド（SPA）のビルド設定。Convex 関数(convex/)とは独立。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
