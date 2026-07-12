import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useAppOutletContext } from "../../components/AppLayout/AppLayout";
import { IssueStats } from "../../components/IssueStats/IssueStats";
import { IssueTable } from "../../components/IssueTable/IssueTable";
import { NewIssueForm } from "../../components/NewIssueForm/NewIssueForm";
import { Skeleton } from "../../components/Skeleton/Skeleton";
import s from "./IssuesView.module.css";

/**
 * Issue タブ本体。issues.list をこの1箇所だけで購読し、分布サマリー
 * （IssueStats）・作成フォーム・指標付き一覧（IssueTable）へ props で配る
 * （二重購読しない）。
 *
 * NewIssueForm は issues.list のロード状態と独立して表示する（issues 購読が
 * 遅くても Issue 作成を開始できるようにする）。currentMember が null の場合の
 * 案内（NoMembersNotice）は AppLayout 側で一元表示するためここでは出さない。
 */
export function IssuesView() {
  const { selected, currentMember } = useAppOutletContext();
  const issues = useQuery(api.issues.list, { project: selected._id });

  return (
    <main className={s.page}>
      {currentMember !== null && (
        <NewIssueForm createdBy={currentMember._id} project={selected._id} />
      )}
      {issues === undefined ? (
        <output aria-label="Issue を読み込み中" className={s.loading}>
          <Skeleton className={s.skeletonStats} />
          <Skeleton className={s.skeletonPanel} />
        </output>
      ) : (
        <>
          <IssueStats issues={issues} />
          <IssueTable issues={issues} projectKey={selected.key} />
        </>
      )}
    </main>
  );
}
