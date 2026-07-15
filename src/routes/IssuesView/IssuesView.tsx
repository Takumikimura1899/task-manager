import { useQuery } from "convex/react";
import { useMemo } from "react";
import { api } from "../../../convex/_generated/api";
import { useAppOutletContext } from "../../components/AppLayout/AppLayout";
import { FilterBar } from "../../components/FilterBar/FilterBar";
import { IssueStats } from "../../components/IssueStats/IssueStats";
import { IssueTable } from "../../components/IssueTable/IssueTable";
import { NewIssueForm } from "../../components/NewIssueForm/NewIssueForm";
import { Skeleton } from "../../components/Skeleton/Skeleton";
import { useFilterParams } from "../../lib/filterParams";
import s from "./IssuesView.module.css";

/**
 * Issue タブ本体。issues.list をこの1箇所だけで購読し、分布サマリー
 * （IssueStats）・作成フォーム・指標付き一覧（IssueTable）へ props で配る
 * （二重購読しない）。
 *
 * NewIssueForm は issues.list のロード状態と独立して表示する（issues 購読が
 * 遅くても Issue 作成を開始できるようにする）。currentMember が null の場合の
 * 案内（NoMembersNotice）は AppLayout 側で一元表示するためここでは出さない。
 *
 * フィルタ（Issue #91）は issues.list の返り値をメモリ上で絞り込むクライアント
 * 側フィルタで、状態は URL search params に外在化する（useFilterParams・
 * docs/詳細画面設計.md 参照）。IssueStats には俯瞰の分母を維持するためフィルタ
 * 前の issues を渡し、IssueTable にはフィルタ後を渡す（件数表示が追従する）。
 */
export function IssuesView() {
  const { selected, currentMember, members } = useAppOutletContext();
  const issues = useQuery(api.issues.list, { project: selected._id });
  const [filter, setFilter] = useFilterParams();

  // filter →（将来 #93 で sort が挿入される）のパイプライン形にしておく。
  const filteredIssues = useMemo(() => {
    if (issues === undefined) return undefined;
    return issues.filter((issue) => {
      if (filter.status !== null && issue.status !== filter.status) {
        return false;
      }
      if (filter.priority !== null && issue.priority !== filter.priority) {
        return false;
      }
      if (
        filter.assignee !== null &&
        !issue.assignees.includes(filter.assignee)
      ) {
        return false;
      }
      return true;
    });
  }, [issues, filter]);

  return (
    <main className={s.page}>
      {currentMember !== null && (
        <NewIssueForm createdBy={currentMember._id} project={selected._id} />
      )}
      <FilterBar
        attributes={["status", "priority", "assignee"]}
        members={members}
        onChange={setFilter}
        value={filter}
      />
      {issues === undefined || filteredIssues === undefined ? (
        <output aria-label="Issue を読み込み中" className={s.loading}>
          <Skeleton className={s.skeletonStats} />
          <Skeleton className={s.skeletonPanel} />
        </output>
      ) : (
        <>
          <IssueStats issues={issues} />
          <IssueTable issues={filteredIssues} projectKey={selected.key} />
        </>
      )}
    </main>
  );
}
