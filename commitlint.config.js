// Conventional Commits の検証ルール（commit-msg フックで実行）
// 本文は日本語を許容する（大文字小文字・文末ピリオドの規則を無効化）。
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // 日本語の subject では case 概念が無いため無効化
    "subject-case": [0],
    // 日本語の句点（。）等を許容
    "subject-full-stop": [0],
    // type は必須・既定の enum を踏襲（feat/fix/docs/refactor/test/chore など）
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "docs",
        "style",
        "refactor",
        "perf",
        "test",
        "build",
        "ci",
        "chore",
        "revert",
      ],
    ],
    // 日本語は文字幅が大きいため上限を緩める
    "header-max-length": [2, "always", 100],
  },
};
