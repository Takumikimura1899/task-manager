import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { type Priority, PRIORITY_OPTIONS } from "../../lib/taskMeta";
import s from "./TaskMetaFields.module.css";

/**
 * Task の優先度・担当者を選ぶ共通フィールド（作成フォームで再利用）。
 * 担当者候補は projectMembers.listByProject（当該プロジェクトの参加者のみ）
 * から取得する。以前は members.list（全社名簿）を使っており、非参加 Member を
 * 選べてしまう「選べるが保存で失敗する担当者」が発生していた（ADR-11 §10 D2）。
 */
export function TaskMetaFields({
  project,
  priority,
  onPriority,
  assignee,
  onAssignee,
}: {
  project: Id<"projects">;
  priority: Priority;
  onPriority: (p: Priority) => void;
  assignee: Id<"members"> | null;
  onAssignee: (a: Id<"members"> | null) => void;
}) {
  const members = useQuery(api.projectMembers.listByProject, { project });

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
            <option key={m.member._id} value={m.member._id}>
              {m.member.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
