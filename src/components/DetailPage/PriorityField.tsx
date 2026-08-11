import { PRIORITY_OPTIONS, type Priority } from "../../lib/taskMeta";
import s from "./DetailPage.module.css";

/** Issue/Task 編集フォームに差し込む優先度セレクト。 */
export function PriorityField({
  value,
  onChange,
}: {
  value: Priority;
  onChange: (priority: Priority) => void;
}) {
  return (
    <label className={s.editField}>
      優先度
      <select
        className={s.editSelect}
        onChange={(e) => onChange(e.target.value as Priority)}
        value={value}
      >
        {PRIORITY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
