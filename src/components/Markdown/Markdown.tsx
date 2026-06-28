import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import s from "./Markdown.module.css";

/**
 * description（Markdown）の安全な描画ラッパ（詳細設計 ADR-D3）。
 * GFM（表・打ち消し線・タスクリスト等）に対応する。
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className={s.prose}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
