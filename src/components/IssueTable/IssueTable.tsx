import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ISSUE_STATUS_LABELS, type IssueSummary } from "../../lib/issueMeta";
import { PRIORITY_LABELS } from "../../lib/taskMeta";
import { Badge } from "../Badge/Badge";
import s from "./IssueTable.module.css";

/** 削除確認待ちの Issue（§6 Human-in-the-Loop）。 */
type PendingDelete = { id: Id<"issues">; revision: number };

/**
 * Issue の指標付き一覧テーブル。issues.list の購読は IssuesView に一本化し、
 * ここは props で受け取った配列を表示するだけ（削除ミューテーションのみ持つ）。
 */
export function IssueTable({
  issues,
  projectKey,
}: {
  issues: readonly IssueSummary[];
  projectKey: string;
}) {
  const removeIssue = useMutation(api.issues.remove);
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requestDelete = (issue: IssueSummary) => {
    setError(null);
    setPending({ id: issue._id, revision: issue.revision });
  };

  const confirmDelete = async () => {
    if (pending === null) return;
    setError(null);
    try {
      await removeIssue({
        id: pending.id,
        expectedRevision: pending.revision,
      });
      setPending(null);
    } catch (err) {
      setError(
        err instanceof ConvexError ? String(err.data) : "削除に失敗しました",
      );
    }
  };

  if (issues.length === 0) {
    return (
      <section className={s.panel}>
        <h2 className={s.heading}>Issue 一覧（0）</h2>
        <p className={s.empty}>Issue がありません。</p>
      </section>
    );
  }

  return (
    <section className={s.panel}>
      <h2 className={s.heading}>Issue 一覧（{issues.length}）</h2>
      <div className={s.wrapper}>
        <table className={s.table}>
          <thead>
            <tr>
              <th className={s.th} scope="col">
                Issue
              </th>
              <th className={s.th} scope="col">
                ステータス
              </th>
              <th className={s.th} scope="col">
                タイトル
              </th>
              <th className={s.th} scope="col">
                優先度
              </th>
              <th className={s.th} scope="col">
                タスク
              </th>
              <th className={s.th} scope="col">
                予想
              </th>
              <th className={s.th} scope="col">
                実績
              </th>
              <th className={s.th} scope="col">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            {issues.map((issue) => {
              const percent =
                issue.taskCount === 0
                  ? 0
                  : Math.round((issue.doneCount / issue.taskCount) * 100);
              const isPending = pending !== null && pending.id === issue._id;
              return (
                <Fragment key={issue._id}>
                  <tr>
                    <td className={`${s.td} ${s.ref}`}>
                      {projectKey}#{issue.number}
                    </td>
                    <td className={s.td}>
                      <Badge status={issue.status}>
                        {ISSUE_STATUS_LABELS[issue.status]}
                      </Badge>
                    </td>
                    <td className={s.td}>
                      <Link
                        className={s.titleLink}
                        to={`/${projectKey}/issues/${issue.number}`}
                      >
                        {issue.title}
                      </Link>
                    </td>
                    <td className={s.td}>{PRIORITY_LABELS[issue.priority]}</td>
                    <td className={s.td}>
                      <div className={s.progress}>
                        <progress
                          aria-label={`タスク進捗 ${issue.doneCount}/${issue.taskCount}`}
                          className={s.progressBar}
                          max={100}
                          value={percent}
                        />
                        <span className={`${s.progressText} ${s.numeric}`}>
                          {issue.doneCount}/{issue.taskCount}
                        </span>
                      </div>
                    </td>
                    {/* 合計 0 は「未入力」と区別できないため、予想・実績とも
                        「—」で未入力扱いに統一する（0h 見積の区別は現状不要）。 */}
                    <td className={`${s.td} ${s.numeric}`}>
                      {issue.estimateTotal === 0
                        ? "—"
                        : `${issue.estimateTotal}h`}
                    </td>
                    <td className={`${s.td} ${s.numeric}`}>
                      {issue.actualTotal === 0 ? "—" : `${issue.actualTotal}h`}
                    </td>
                    <td className={s.td}>
                      <button
                        className={s.deleteButton}
                        onClick={() => requestDelete(issue)}
                        type="button"
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                  {isPending && (
                    <tr>
                      <td className={s.confirmCell} colSpan={8}>
                        <div className={s.confirmPanel}>
                          <p className={s.confirmMessage}>
                            この Issue と配下のタスク・Git
                            連携をすべて削除します。取り消せません。
                          </p>
                          <div className={s.confirmActions}>
                            <button
                              className={s.danger}
                              onClick={() => void confirmDelete()}
                              type="button"
                            >
                              削除する
                            </button>
                            <button
                              className={s.cancel}
                              onClick={() => setPending(null)}
                              type="button"
                            >
                              キャンセル
                            </button>
                          </div>
                          {error !== null && (
                            <p className={s.error} role="alert">
                              {error}
                            </p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
