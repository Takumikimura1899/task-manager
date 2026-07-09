import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ISSUE_STATUS_LABELS } from "../../lib/issueMeta";
import { Badge } from "../Badge/Badge";
import { Skeleton } from "../Skeleton/Skeleton";
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

  // 読み込み中も見出しとパネル枠を維持し、行の矩形だけをスケルトンで示す
  // （Issue #29：全画面差し替えをやめる）。
  if (issues === undefined) {
    return (
      <section className={s.panel}>
        <h2 className={s.heading}>Issue</h2>
        <output aria-label="Issue を読み込み中" className={s.list}>
          <Skeleton className={s.skeletonRow} />
          <Skeleton className={s.skeletonRow} />
          <Skeleton className={s.skeletonRow} />
        </output>
      </section>
    );
  }

  // 0 件でも見出しごと消さず（従来は return null）、上部の「＋ 新規 Issue」
  // フォームへ誘導する空状態メッセージを出す（Issue #29）。
  if (issues.length === 0) {
    return (
      <section className={s.panel}>
        <h2 className={s.heading}>Issue（0）</h2>
        <p className={s.empty}>
          Issue がありません。上の「＋ 新規 Issue」から作成してください。
        </p>
      </section>
    );
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
              <Badge status={status}>{ISSUE_STATUS_LABELS[status]}</Badge>
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
