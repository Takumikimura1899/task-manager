import { ISSUE_STATUSES } from "../../../convex/lib/issueStatus";
import { ISSUE_STATUS_LABELS, type IssueSummary } from "../../lib/issueMeta";
import { Badge } from "../Badge/Badge";
import s from "./IssueStats.module.css";

/**
 * Issue の件数分布サマリー（合計＋派生ステータス別件数）。IssuesView 上部に置く。
 * issues.list の購読は IssuesView に一本化し、ここは props で受け取った配列を
 * 集計するだけの純表示コンポーネント（二重購読しない）。
 */
export function IssueStats({ issues }: { issues: readonly IssueSummary[] }) {
  return (
    <section aria-label="Issue の分布" className={s.panel}>
      <p className={s.total}>
        Issue 合計 <span className={s.totalCount}>{issues.length}</span>
      </p>
      <ul className={s.list}>
        {ISSUE_STATUSES.map((status) => {
          const count = issues.filter(
            (issue) => issue.status === status,
          ).length;
          return (
            <li className={s.item} key={status}>
              <Badge status={status}>{ISSUE_STATUS_LABELS[status]}</Badge>
              <span className={s.count}>{count}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
