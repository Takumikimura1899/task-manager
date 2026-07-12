import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useAppOutletContext } from "../../components/AppLayout/AppLayout";
import { IssueStats } from "../../components/IssueStats/IssueStats";
import { IssueTable } from "../../components/IssueTable/IssueTable";
import { NewIssueForm } from "../../components/NewIssueForm/NewIssueForm";
import { NoMembersNotice } from "../../components/NoMembersNotice/NoMembersNotice";
import { Skeleton } from "../../components/Skeleton/Skeleton";
import s from "./IssuesView.module.css";

/**
 * Issue タブ本体。issues.list をこの1箇所だけで購読し、分布サマリー
 * （IssueStats）・作成フォーム・指標付き一覧（IssueTable）へ props で配る
 * （二重購読しない）。
 */
export function IssuesView() {
  const { selected, members, currentMember } = useAppOutletContext();
  const issues = useQuery(api.issues.list, { project: selected._id });

  return (
    <main className={s.page}>
      {issues === undefined ? (
        <output aria-label="Issue を読み込み中" className={s.loading}>
          <Skeleton className={s.skeletonStats} />
          <Skeleton className={s.skeletonPanel} />
        </output>
      ) : (
        <>
          <IssueStats issues={issues} />
          {currentMember !== null ? (
            <NewIssueForm
              createdBy={currentMember._id}
              project={selected._id}
            />
          ) : (
            // メンバー 0 件では作成手段が消えるため、黙って隠さず理由を案内する
            // （Issue #16）。members 読み込み中（undefined）は判定できないため何も出さない。
            members !== undefined && <NoMembersNotice />
          )}
          <IssueTable issues={issues} projectKey={selected.key} />
        </>
      )}
    </main>
  );
}
