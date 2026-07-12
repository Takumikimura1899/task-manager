import type { MarkdownTemplate } from "./templates";
import s from "./TemplateMenu.module.css";

/**
 * テンプレート選択メニュー。エディタのツールバーコマンドのポップアップとして
 * 表示される想定だが、MDEditor には依存しない純粋なリスト UI。
 */
export function TemplateMenu({
  templates,
  onSelect,
}: {
  templates: MarkdownTemplate[];
  onSelect: (template: MarkdownTemplate) => void;
}) {
  return (
    <div className={s.menu} role="menu">
      {templates.map((template) => (
        <button
          className={s.item}
          key={template.name}
          onClick={() => onSelect(template)}
          role="menuitem"
          type="button"
        >
          {template.label}
        </button>
      ))}
    </div>
  );
}
