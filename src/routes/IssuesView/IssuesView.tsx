import { useQuery } from "convex/react";
import { useMemo } from "react";
import { api } from "../../../convex/_generated/api";
import { useAppOutletContext } from "../../components/AppLayout/AppLayout";
import { FilterBar } from "../../components/FilterBar/FilterBar";
import { IssueStats } from "../../components/IssueStats/IssueStats";
import { IssueTable } from "../../components/IssueTable/IssueTable";
import { NewIssueForm } from "../../components/NewIssueForm/NewIssueForm";
import { Skeleton } from "../../components/Skeleton/Skeleton";
import { SortBar } from "../../components/SortBar/SortBar";
import { useIssueListParams } from "../../lib/filterParams";
import type { IssueSummary } from "../../lib/issueMeta";
import { PRIORITY_WEIGHT } from "../../lib/taskMeta";
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
 * フィルタ（Issue #91・何を出すか）とソート（Issue #93・どう見せるか）は
 * 直交する概念として、issues.list の返り値に対し filter → sort の順で
 * メモリ上パイプラインを適用する（状態は useIssueListParams で URL search
 * params に一括外在化する。同一 React バッチ内で filter/sort を両方更新
 * しても後勝ちで一方が失われないよう、1回の setSearchParams で両キー空間を
 * 書く統合経路を使う。Issue #98・docs/詳細画面設計.md §8 参照）。
 * IssueStats には俯瞰の分母を維持するためフィルタ・ソート前の issues を渡し、
 * IssueTable にはフィルタ→ソート後を渡す（件数表示・並び順が追従する）。
 */
export function IssuesView() {
  const { selected, currentMember, members } = useAppOutletContext();
  const issues = useQuery(api.issues.list, { project: selected._id });
  const [{ filter, sort }, setListParams] = useIssueListParams();

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

  // sort が null の場合はサーバー返却順（フィルタ結果）をそのまま維持する。
  // 購読配列・フィルタ結果を破壊しないよう toSorted() で新規配列を作る
  // （sort() は破壊的なため使わない）。priority は重み（PRIORITY_WEIGHT）で
  // 比較し文字列比較にしない（none < low < medium < high < urgent の意味順を
  // 保証するため）。dir === "desc" は比較結果の符号を反転して表す（安定ソート
  // を保ったまま昇順/降順を切り替える。配列を昇順ソート後に reverse すると
  // 同順位の相対順序が崩れるため使わない）。
  const sortedIssues = useMemo(() => {
    if (filteredIssues === undefined) return undefined;
    if (sort === null) return filteredIssues;

    const baseCompare: (a: IssueSummary, b: IssueSummary) => number =
      sort.field === "priority"
        ? (a, b) => PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority]
        : (a, b) => a.updatedAt - b.updatedAt;
    const compare =
      sort.dir === "desc"
        ? (a: IssueSummary, b: IssueSummary) => -baseCompare(a, b)
        : baseCompare;

    return filteredIssues.toSorted(compare);
  }, [filteredIssues, sort]);

  return (
    <main className={s.page}>
      {currentMember !== null && (
        <NewIssueForm createdBy={currentMember._id} project={selected._id} />
      )}
      <div className={s.controls}>
        <FilterBar
          attributes={["status", "priority", "assignee"]}
          members={members}
          onChange={(nextFilter) => setListParams({ filter: nextFilter, sort })}
          value={filter}
        />
        <SortBar
          onChange={(nextSort) => setListParams({ filter, sort: nextSort })}
          value={sort}
        />
      </div>
      {issues === undefined || sortedIssues === undefined ? (
        <output aria-label="Issue を読み込み中" className={s.loading}>
          <Skeleton className={s.skeletonStats} />
          <Skeleton className={s.skeletonPanel} />
        </output>
      ) : (
        <>
          <IssueStats issues={issues} />
          <IssueTable issues={sortedIssues} projectKey={selected.key} />
        </>
      )}
    </main>
  );
}
