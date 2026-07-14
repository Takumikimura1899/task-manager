import { useMutation, useQuery } from "convex/react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { AddTaskForm } from "../../components/AddTaskForm/AddTaskForm";
import { Badge } from "../../components/Badge/Badge";
import { DetailEditForm } from "../../components/DetailEditForm/DetailEditForm";
import { DetailMeta } from "../../components/DetailMeta/DetailMeta";
import { Markdown } from "../../components/Markdown/Markdown";
import { ISSUE_TEMPLATES } from "../../components/MarkdownEditor/templates";
import { NoMembersNotice } from "../../components/NoMembersNotice/NoMembersNotice";
import { Skeleton } from "../../components/Skeleton/Skeleton";
import { TaskCard } from "../../components/TaskCard/TaskCard";
import { useCurrentMember } from "../../hooks/useCurrentMember";
import { useEditForm } from "../../hooks/useEditForm";
import { formatIssueRef } from "../../lib/formatIssueRef";
import { ISSUE_STATUS_LABELS } from "../../lib/issueMeta";
import { parseRefNumber } from "../../lib/routeParams";
import {
  PRIORITY_LABELS,
  PRIORITY_OPTIONS,
  type Priority,
  TASK_STATUS_LABELS,
  TASK_STATUS_ORDER,
} from "../../lib/taskMeta";
import s from "./IssueDetail.module.css";

/**
 * 編集フォームの下書き（タイトル・説明・優先度）。
 * revision は編集開始時点の値を保持し、保存時の expectedRevision に使う。
 * 購読中の最新値を使うと、編集中の他者更新で expectedRevision も追従して
 * しまい競合を検知できないため（Issue #73）。
 */
type IssueDraft = {
  title: string;
  description: string;
  priority: Priority;
  revision: number;
};

export function IssueDetail() {
  const params = useParams();
  const projectKey = params.projectKey ?? "";
  const number = parseRefNumber(params.number);

  const issue = useQuery(
    api.issues.getByRef,
    number !== null ? { projectKey, number } : "skip",
  );
  const { members, currentMember } = useCurrentMember();

  const updateIssue = useMutation(api.issues.update);
  // 保存時の expectedRevision は編集開始時点の revision（draft.revision）を
  // 送る（INVARIANT-2）。編集中に他者が更新していれば競合として検知される。
  const edit = useEditForm<IssueDraft>({
    save: async (draft) => {
      if (issue === null || issue === undefined) return;
      await updateIssue({
        id: issue._id,
        expectedRevision: draft.revision,
        title: draft.title.trim(),
        description: draft.description,
        priority: draft.priority,
      });
    },
  });

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

  // 編集の初期値・競合後の再読込は常に最新の購読値から作る。
  const toDraft = (): IssueDraft => ({
    title: issue.title,
    description: issue.description ?? "",
    priority: issue.priority,
    revision: issue.revision,
  });

  return (
    <main className={s.page}>
      <Link className={s.back} to="/">
        ← 一覧へ
      </Link>

      <header className={s.header}>
        <div className={s.heading}>
          <span className={s.ref}>{formatIssueRef(issue.number)}</span>
          <Badge status={status}>{ISSUE_STATUS_LABELS[status]}</Badge>
          {!edit.editing && (
            <button
              className={s.edit}
              onClick={() => edit.open(toDraft())}
              type="button"
            >
              編集
            </button>
          )}
        </div>
        {!edit.editing && (
          <>
            <h1 className={s.title}>{issue.title}</h1>
            <p className={s.progress}>
              タスク {doneCount}/{activeTasks.length} 完了
            </p>
          </>
        )}
      </header>

      {edit.editing && edit.draft !== null ? (
        <section className={s.section}>
          <DetailEditForm
            conflict={edit.conflict}
            description={edit.draft.description}
            error={edit.error}
            formLabel="Issue を編集"
            onCancel={edit.close}
            onDescription={(description) => edit.update({ description })}
            onReload={() => edit.open(toDraft())}
            onSubmit={edit.submit}
            onTitle={(title) => edit.update({ title })}
            saving={edit.saving}
            templates={ISSUE_TEMPLATES}
            title={edit.draft.title}
          >
            <label className={s.editField}>
              優先度
              <select
                className={s.editSelect}
                onChange={(e) =>
                  edit.update({ priority: e.target.value as Priority })
                }
                value={edit.draft.priority}
              >
                {PRIORITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </DetailEditForm>
        </section>
      ) : (
        issue.description !== undefined &&
        issue.description !== "" && (
          <section className={s.section}>
            <Markdown>{issue.description}</Markdown>
          </section>
        )
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
        {currentMember !== null ? (
          <AddTaskForm createdBy={currentMember._id} issue={issue._id} />
        ) : (
          // メンバー 0 件では作成手段が消えるため、黙って隠さず理由を案内する
          // （Issue #16、AppLayout.tsx と同方針）。members 読み込み中（undefined）は
          // 判定できないため何も出さない。
          members !== undefined && <NoMembersNotice />
        )}
      </section>

      <section className={s.section}>
        <dl className={s.props}>
          <dt className={s.term}>優先度</dt>
          <dd className={s.value}>{PRIORITY_LABELS[issue.priority]}</dd>
        </dl>
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
