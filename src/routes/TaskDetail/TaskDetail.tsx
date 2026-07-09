import { useQuery } from "convex/react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { Badge } from "../../components/Badge/Badge";
import { DetailMeta } from "../../components/DetailMeta/DetailMeta";
import { GitLinkList } from "../../components/GitLinkList/GitLinkList";
import { Markdown } from "../../components/Markdown/Markdown";
import { Skeleton } from "../../components/Skeleton/Skeleton";
import { parseRefNumber } from "../../lib/routeParams";
import { PRIORITY_LABELS, TASK_STATUS_LABELS } from "../../lib/taskMeta";
import s from "./TaskDetail.module.css";

export function TaskDetail() {
  const params = useParams();
  const projectKey = params.projectKey ?? "";
  const number = parseRefNumber(params.number);

  const task = useQuery(
    api.tasks.getDetail,
    number !== null ? { projectKey, number } : "skip",
  );

  if (number === null || task === null) {
    return (
      <main className={s.page}>
        <Link className={s.back} to="/">
          ← 一覧へ
        </Link>
        <p className="hint">タスクが見つかりませんでした。</p>
      </main>
    );
  }

  // 読み込み中もページ枠と戻り導線を維持し、見出し・本文セクションの
  // 矩形をスケルトンで示す（Issue #29：全画面差し替えをやめる）。
  if (task === undefined) {
    return (
      <main className={s.page}>
        <Link className={s.back} to="/">
          ← 一覧へ
        </Link>
        <output aria-label="タスクを読み込み中" className={s.loading}>
          <Skeleton className={s.skeletonHeading} />
          <Skeleton className={s.skeletonTitle} />
          <Skeleton className={s.skeletonSection} />
          <Skeleton className={s.skeletonSection} />
        </output>
      </main>
    );
  }

  return (
    <main className={s.page}>
      <Link className={s.back} to="/">
        ← 一覧へ
      </Link>

      {task.issueNumber !== null && (
        <Link
          className={s.breadcrumb}
          to={`/${task.projectKey}/issues/${task.issueNumber}`}
        >
          {task.projectKey}#{task.issueNumber}
          {task.issueTitle !== null && ` ${task.issueTitle}`}
        </Link>
      )}

      <header className={s.header}>
        <div className={s.heading}>
          <span className={s.ref}>
            {task.projectKey}-{task.number}
          </span>
          <Badge status={task.status}>{TASK_STATUS_LABELS[task.status]}</Badge>
        </div>
        <h1 className={s.title}>{task.title}</h1>
      </header>

      {task.description !== undefined && task.description !== "" && (
        <section className={s.section}>
          <Markdown>{task.description}</Markdown>
        </section>
      )}

      <section className={s.section}>
        <dl className={s.props}>
          <dt className={s.term}>ステータス</dt>
          <dd className={s.value}>{TASK_STATUS_LABELS[task.status]}</dd>
          <dt className={s.term}>優先度</dt>
          <dd className={s.value}>{PRIORITY_LABELS[task.priority]}</dd>
          <dt className={s.term}>担当者</dt>
          <dd className={s.value}>{task.assigneeName ?? "未割り当て"}</dd>
        </dl>
      </section>

      <section className={s.section}>
        <h2 className={s.sectionTitle}>Git 連携</h2>
        <GitLinkList links={task.gitLinks} />
      </section>

      <section className={s.section}>
        <DetailMeta
          createdAt={task._creationTime}
          createdByName={task.createdByName}
          updatedAt={task.updatedAt}
        />
      </section>
    </main>
  );
}
