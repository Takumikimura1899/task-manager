import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ISSUE_STATUS_LABELS } from "../../lib/issueMeta";
import { AddTaskForm } from "./AddTaskForm";
import s from "./IssueList.module.css";

export function IssueList({
  project,
  projectKey,
  createdBy,
}: {
  project: Id<"projects">;
  projectKey: string;
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
          const status = issue.status;
          return (
            <article className={s.item} key={issue._id}>
              <span className={s.ref}>Issue #{issue.number}</span>
              <span className={`${s.badge} ${s[status]}`}>
                {ISSUE_STATUS_LABELS[status]}
              </span>
              <Link
                className={s.title}
                to={`/${projectKey}/issues/${issue.number}`}
              >
                {issue.title}
              </Link>
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
