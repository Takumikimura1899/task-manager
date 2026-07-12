/**
 * 説明欄に挿入する Markdown テンプレート（GitHub の Issue テンプレート相当）。
 * コード定義の固定運用とし、プロジェクト別管理が必要になったら DB 管理へ移行する。
 */
export type MarkdownTemplate = {
  /** 一意キー（React の key 用） */
  name: string;
  /** メニュー表示名 */
  label: string;
  /** 挿入する Markdown 本文 */
  content: string;
};

export const ISSUE_TEMPLATES: MarkdownTemplate[] = [
  {
    name: "feature",
    label: "機能",
    content: "## 背景\n\n\n## やること\n\n- [ ] \n\n## 完了条件\n\n- [ ] \n",
  },
  {
    name: "bug",
    label: "バグ報告",
    content: "## 事象\n\n\n## 再現手順\n\n1. \n\n## 期待する挙動\n\n",
  },
];

export const TASK_TEMPLATES: MarkdownTemplate[] = [
  {
    name: "default",
    label: "標準タスク",
    content: "## やること\n\n- [ ] \n\n## 完了条件\n\n- [ ] \n",
  },
];
