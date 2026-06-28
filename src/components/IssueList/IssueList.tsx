import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { AddTaskForm } from "./AddTaskForm";
import s from "./IssueList.module.css";

// Issue 派生ステータス（§5.1）の表示ラベル。
const STATUS_LABELS = {
  open: "未着手",
  in_progress: "着手中",
  done: "完了",
  canceled: "中止",
} as const;

type IssueStatus = keyof typeof STATUS_LABELS;

export function IssueList({
  project,
  createdBy,
}: {
  project: Id<"projects">;
  createdBy: Id<"members"> | null;
}) {
  const issues = useQuery(api.issues.list, { project });

  if (issues === undefined) {
    return <p className="hint">読み込み中…</p>;
  }

  if (issues.length === 0) {
    return null;
  }

  return (
    <section className={s.panel}>
      <h2 className={s.heading}>Issue（{issues.length}）</h2>
      <div className={s.list}>
        {issues.map((issue) => {
          const status = issue.status as IssueStatus;
          return (
            <article className={s.item} key={issue._id}>
              <span className={s.ref}>Issue #{issue.number}</span>
              <span className={`${s.badge} ${s[status]}`}>
                {STATUS_LABELS[status]}
              </span>
              <span className={s.title}>{issue.title}</span>
              <span className={s.count}>
                タスク {issue.doneCount}/{issue.taskCount} 完了
              </span>
              {createdBy !== null && (
                <AddTaskForm createdBy={createdBy} issue={issue._id} />
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
