import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { formatIssueRef } from "../../lib/formatIssueRef";
import { Skeleton } from "../Skeleton/Skeleton";
import s from "./ActiveIssueStrip.module.css";

/**
 * 進行中（in_progress）Issue だけを横並びチップで示す読み取り専用の帯。
 * Board の直上に置き、いま着手中の Issue を一目で把握できるようにする。
 */
export function ActiveIssueStrip({
  project,
  projectKey,
}: {
  project: Id<"projects">;
  projectKey: string;
}) {
  const issues = useQuery(api.issues.listInProgress, { project });

  // 読み込み中も帯の高さを保つため、行数分ではなく1行分のスケルトンだけ示す。
  if (issues === undefined) {
    return (
      <output aria-label="進行中の Issue を読み込み中" className={s.strip}>
        <Skeleton className={s.skeletonChip} />
      </output>
    );
  }

  // null は「未リンク viewer」または「project 自体が存在しない」場合
  // （ADR-11 projectQuery の型契約。非参加 linked Member は throw されるため
  // ここでは扱わない・convex/lib/auth.ts の projectQuery 参照。詳細な案内は
  // PR③ で整備し、PR② では最低限のガードに留める）。
  if (issues === null) {
    return <p className={s.empty}>プロジェクトが見つかりません。</p>;
  }

  // 0 件を黙って隠さず、進行中の Issue が無いことを明示する（Issue #16 方針）。
  // in_progress への絞り込みはサーバー側（listInProgress）で完結している。
  if (issues.length === 0) {
    return <p className={s.empty}>進行中の Issue はありません。</p>;
  }

  return (
    <div className={s.strip}>
      {issues.map((issue) => (
        <Link
          className={s.chip}
          key={issue._id}
          to={`/${projectKey}/issues/${issue.number}`}
        >
          <span className={s.ref}>{formatIssueRef(issue.number)}</span>
          <span className={s.title}>{issue.title}</span>
          <span className={s.count}>
            {issue.doneCount}/{issue.taskCount}
          </span>
        </Link>
      ))}
    </div>
  );
}
