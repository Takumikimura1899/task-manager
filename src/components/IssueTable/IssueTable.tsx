import { Link } from "react-router-dom";
import { formatHoursTotal } from "../../lib/formatHours";
import { formatIssueRef } from "../../lib/formatIssueRef";
import { ISSUE_STATUS_LABELS, type IssueSummary } from "../../lib/issueMeta";
import { PRIORITY_LABELS } from "../../lib/taskMeta";
import { Badge } from "../Badge/Badge";
import s from "./IssueTable.module.css";

/**
 * Issue の指標付き一覧テーブル。issues.list の購読は IssuesView に一本化し、
 * ここは props で受け取った配列を表示するだけ。削除導線は Issue 詳細の
 * danger セクションに一本化されている（#105）。
 */
export function IssueTable({
  issues,
  projectKey,
}: {
  issues: readonly IssueSummary[];
  projectKey: string;
}) {
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
                Task
              </th>
              <th className={s.th} scope="col">
                予想
              </th>
              <th className={s.th} scope="col">
                実績
              </th>
            </tr>
          </thead>
          <tbody>
            {issues.map((issue) => {
              const percent =
                issue.taskCount === 0
                  ? 0
                  : Math.round((issue.doneCount / issue.taskCount) * 100);
              return (
                <tr key={issue._id}>
                  <td className={`${s.td} ${s.ref}`}>
                    {formatIssueRef(issue.number)}
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
                        aria-label={`Task 進捗 ${issue.doneCount}/${issue.taskCount}`}
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
                      「—」で未入力扱いに統一する（丸めて 0 になる極小値も
                      formatHoursTotal 側で同様に扱う）。 */}
                  <td className={`${s.td} ${s.numeric}`}>
                    {formatHoursTotal(issue.estimateTotal)}
                  </td>
                  <td className={`${s.td} ${s.numeric}`}>
                    {formatHoursTotal(issue.actualTotal)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
