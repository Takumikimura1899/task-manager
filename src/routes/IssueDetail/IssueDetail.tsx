import { useQuery } from "convex/react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { Badge } from "../../components/Badge/Badge";
import { DetailMeta } from "../../components/DetailMeta/DetailMeta";
import { Markdown } from "../../components/Markdown/Markdown";
import { Skeleton } from "../../components/Skeleton/Skeleton";
import { TaskCard } from "../../components/TaskCard/TaskCard";
import { ISSUE_STATUS_LABELS } from "../../lib/issueMeta";
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

  // 読み込み中もページ枠と戻り導線を維持し、見出し・本文セクションの
  // 矩形をスケルトンで示す（Issue #29：全画面差し替えをやめる）。
  if (issue === undefined) {
    return (
      <main className={s.page}>
        <Link className={s.back} to="/">
          ← 一覧へ
        </Link>
        <output aria-label="Issue を読み込み中" className={s.loading}>
          <Skeleton className={s.skeletonHeading} />
          <Skeleton className={s.skeletonTitle} />
          <Skeleton className={s.skeletonSection} />
          <Skeleton className={s.skeletonSection} />
        </output>
      </main>
    );
  }

  const status = issue.status;
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
          <Badge status={status}>{ISSUE_STATUS_LABELS[status]}</Badge>
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
                    task={task}
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
