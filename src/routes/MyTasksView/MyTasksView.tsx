import { useQuery } from "convex/react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { Skeleton } from "../../components/Skeleton/Skeleton";
import { TaskCard } from "../../components/TaskCard/TaskCard";
import { groupMyTasks } from "../../lib/myTasks";
import { TASK_STATUS_LABELS } from "../../lib/taskMeta";
import s from "./MyTasksView.module.css";

/**
 * 「My Tasks」タブ本体（全プロジェクト横断で「担当者=自分」の Task を
 * status 別に表示する読み取り専用ビュー）。tasks.listMine をこの1箇所だけで
 * 購読し、status グルーピング・ソートは純粋関数（src/lib/myTasks.ts）に
 * 委ねる。全件が自分の担当のため assigneeName は渡さない（冗長）。
 * プロジェクト非依存のため useAppOutletContext は使わない。
 */
export function MyTasksView() {
  const tasks = useQuery(api.tasks.listMine, {});
  const sections = useMemo(
    () => (tasks === undefined ? undefined : groupMyTasks(tasks)),
    [tasks],
  );

  return (
    <main className={s.page}>
      {sections === undefined ? (
        <output aria-label="担当 Task を読み込み中" className={s.loading}>
          <Skeleton className={s.skeletonPanel} />
        </output>
      ) : sections.length === 0 ? (
        <p className={s.empty}>
          担当している Task がありません。Task
          の詳細画面の「担当者」で自分を選ぶと、ここに表示されます。
          <Link className={`inline-link ${s.emptyLink}`} to="/">
            Task 一覧へ
          </Link>
        </p>
      ) : (
        sections.map((section) => (
          <section className={s.section} key={section.status}>
            <h2 className={s.heading}>
              {TASK_STATUS_LABELS[section.status]}
              <span className={s.count}>{section.tasks.length}</span>
            </h2>
            <div className={s.grid}>
              {section.tasks.map((task) => (
                <TaskCard
                  issueNumber={task.issueNumber}
                  key={task._id}
                  projectKey={task.projectKey}
                  task={task}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </main>
  );
}
