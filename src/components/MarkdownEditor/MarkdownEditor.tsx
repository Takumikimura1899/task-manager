import MDEditor, { commands } from "@uiw/react-md-editor";
import rehypeSanitize from "rehype-sanitize";
import { sanitizeSchema } from "../../lib/markdownSanitize";
import { TemplateMenu } from "./TemplateMenu";
import type { MarkdownTemplate } from "./templates";

/**
 * GitHub Issues/PR 風の Markdown エディタ（@uiw/react-md-editor のラッパ）。
 * 値は素の string で入出力するため、useEditForm / 楽観ロックのフローに影響しない。
 * バンドルが重いため呼び出し側（DetailEditForm）で React.lazy 経由で読み込む。
 * スタイルは styles/markdown-theme.css（.w-md-editor）が担う。
 */
export function MarkdownEditor({
  value,
  onChange,
  ariaLabel,
  templates,
}: {
  value: string;
  onChange: (value: string) => void;
  /** 内部 textarea に付与するラベル（フォームの getByLabelText 互換） */
  ariaLabel: string;
  templates: MarkdownTemplate[];
}) {
  return (
    <div data-color-mode="dark">
      <MDEditor
        commands={[...commands.getCommands(), templateCommand(templates)]}
        extraCommands={[
          commands.codeEdit,
          commands.codePreview,
          commands.divider,
          commands.fullscreen,
        ]}
        height={240}
        onChange={(v) => onChange(v ?? "")}
        preview="edit"
        previewOptions={{
          rehypePlugins: [[rehypeSanitize, sanitizeSchema]],
        }}
        textareaProps={{ "aria-label": ariaLabel }}
        value={value}
      />
    </div>
  );
}

/** ツールバー末尾の「テンプレートを挿入」ドロップダウン */
function templateCommand(templates: MarkdownTemplate[]) {
  return commands.group([], {
    name: "insert-template",
    groupName: "insert-template",
    buttonProps: {
      "aria-label": "テンプレートを挿入",
      title: "テンプレートを挿入",
    },
    icon: (
      <svg
        aria-hidden="true"
        fill="none"
        height="12"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        width="12"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h8M8 17h5" />
      </svg>
    ),
    children: ({ close, textApi }) => (
      <TemplateMenu
        onSelect={(template) => {
          textApi?.replaceSelection(template.content);
          close();
        }}
        templates={templates}
      />
    ),
  });
}
