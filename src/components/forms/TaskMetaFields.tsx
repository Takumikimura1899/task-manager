import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { type Priority, PRIORITY_OPTIONS } from "../../lib/taskMeta";
import s from "./TaskMetaFields.module.css";

/**
 * Task の優先度・担当者を選ぶ共通フィールド（作成フォームで再利用）。
 * 担当者候補は members.list（{_id, name} のみ）から取得する。
 */
export function TaskMetaFields({
  priority,
  onPriority,
  assignee,
  onAssignee,
}: {
  priority: Priority;
  onPriority: (p: Priority) => void;
  assignee: Id<"members"> | null;
  onAssignee: (a: Id<"members"> | null) => void;
}) {
  const members = useQuery(api.members.list);

  return (
    <div className={s.row}>
      <label className={s.field}>
        優先度
        <select
          className={s.select}
          onChange={(e) => onPriority(e.target.value as Priority)}
          value={priority}
        >
          {PRIORITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className={s.field}>
        担当者
        <select
          className={s.select}
          onChange={(e) =>
            onAssignee(
              e.target.value === "" ? null : (e.target.value as Id<"members">),
            )
          }
          value={assignee ?? ""}
        >
          <option value="">未割り当て</option>
          {members?.map((m) => (
            <option key={m._id} value={m._id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
