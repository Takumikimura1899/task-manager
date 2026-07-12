import MarkdownPreview from "@uiw/react-markdown-preview";
import rehypeSanitize from "rehype-sanitize";
import { sanitizeSchema } from "../../lib/markdownSanitize";

/**
 * description（Markdown）の安全な描画ラッパ（詳細設計 ADR-D3）。
 * 編集プレビュー（@uiw/react-md-editor）と見た目を揃えるため
 * 同系の @uiw/react-markdown-preview で描画する。GFM・コードハイライト対応。
 * preview は rehype-raw を内蔵し生 HTML を描画するため rehype-sanitize を必須とする。
 * スタイルは styles/markdown-theme.css（.wmde-markdown）が担う。
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div data-color-mode="dark">
      <MarkdownPreview
        rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
        source={children}
      />
    </div>
  );
}
