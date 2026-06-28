/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Convex デプロイの URL（convex dev が .env.local に書き込む） */
  readonly VITE_CONVEX_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
