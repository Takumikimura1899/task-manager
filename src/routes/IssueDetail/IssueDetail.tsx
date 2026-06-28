import { useQuery } from "convex/react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { DetailMeta } from "../../components/DetailMeta/DetailMeta";
import { Markdown } from "../../components/Markdown/Markdown";
import { TaskCard } from "../../components/TaskCard/TaskCard";
import { type IssueStatus, ISSUE_STATUS_LABELS } from "../../lib/issueMeta";
import { parseRefNumber } from "../../lib/routeParams";
import { TASK_STATUS_LABELS, TASK_STATUS_ORDER } from "../../lib/taskMeta";
import s from "./IssueDetail.module.css";

export function IssueDetail() {
  const params = useParams();
  const projectKey = params.projectKey ?? "";
  const number = parseRefNumber(params.number);

  const issue = useQuery(
    api.issues.getByRef,
    number !== null ? { projectKey, number } : "skip",
  );

  if (number === null || issue === null) {
    return (
      <main className={s.page}>
        <Link className={s.back} to="/">
          ← 一覧へ
        </Link>
        <p className="hint">Issue が見つかりませんでした。</p>
      </main>
    );
  }

  if (issue === undefined) {
    return (
      <main className={s.page}>
        <p className="hint">読み込み中…</p>
      </main>
    );
  }

  const status = issue.status as IssueStatus;
  // 進捗は canceled を除いた「実行対象」で集計する（派生ステータスと同基準・§5.1）。
  const activeTasks = issue.tasks.filter((t) => t.status !== "canceled");
  const doneCount = activeTasks.filter((t) => t.status === "done").length;

  return (
    <main className={s.page}>
      <Link className={s.back} to="/">
        ← 一覧へ
      </Link>

      <header className={s.header}>
        <div className={s.heading}>
          <span className={s.ref}>
            {issue.projectKey}#{issue.number}
          </span>
          <span className={`${s.badge} ${s[status]}`}>
            {ISSUE_STATUS_LABELS[status]}
          </span>
        </div>
        <h1 className={s.title}>{issue.title}</h1>
        <p className={s.progress}>
          タスク {doneCount}/{activeTasks.length} 完了
        </p>
      </header>

      {issue.description !== undefined && issue.description !== "" && (
        <section className={s.section}>
          <Markdown>{issue.description}</Markdown>
        </section>
      )}

      <section className={s.section}>
        <h2 className={s.sectionTitle}>タスク（{issue.tasks.length}）</h2>
        {TASK_STATUS_ORDER.map((taskStatus) => {
          const tasks = issue.tasks.filter((t) => t.status === taskStatus);
          if (tasks.length === 0) return null;
          return (
            <div className={s.group} key={taskStatus}>
              <h3 className={s.groupTitle}>
                {TASK_STATUS_LABELS[taskStatus]}（{tasks.length}）
              </h3>
              <div className={s.cards}>
                {tasks.map((task) => (
                  <TaskCard
                    assigneeName={task.assigneeName}
                    key={task._id}
                    projectKey={issue.projectKey}
                    task={task as Doc<"tasks">}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <section className={s.section}>
        <DetailMeta
          createdAt={issue._creationTime}
          createdByName={issue.createdByName}
          updatedAt={issue.updatedAt}
        />
      </section>
    </main>
  );
}
