import { useQuery } from "convex/react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { useAppOutletContext } from "../../components/AppLayout/AppLayout";
import { Skeleton } from "../../components/Skeleton/Skeleton";
import { TaskCard } from "../../components/TaskCard/TaskCard";
import { useTodayIso } from "../../hooks/useTodayIso";
import { MEMBER_ROLE_LABELS } from "../../lib/memberMeta";
import { DUE_BUCKET_LABELS, groupMyTasksByDueDate } from "../../lib/myTasks";
import s from "./MyPageView.module.css";

/**
 * 「My Page」タブ本体（ログイン後の個人ダッシュボード）。
 *
 * 上部プロフィール行（名前・role・所属プロジェクトのチップ）＋タスクセクション
 * （全プロジェクト横断で「担当者=自分」の Task を期限軸でグルーピングした
 * 読み取り専用ビュー）で構成する。tasks.listMine をこの1箇所だけで購読し、
 * グルーピングは純粋関数（src/lib/myTasks.ts）に委ねる。全件が自分の担当の
 * ため assigneeName は渡さない（冗長）。
 *
 * currentMember / projects は AppLayout が既に購読済みのため
 * useAppOutletContext から取り出す（members.me / projects.list の二重購読を
 * 避ける）。所属プロジェクトのチップは「担当 Task を持つプロジェクト」から
 * 導出する（schema に project 所属を表す関係が無いため、これが唯一の
 * 観測可能なシグナル）。
 */
export function MyPageView() {
  const tasks = useQuery(api.tasks.listMine, {});
  const { projects, currentMember, currentMemberLoading, selectProject } =
    useAppOutletContext();
  // レンダー時に todayIso() を直接評価するだけだと、購読データに変化が
  // ない限り日跨ぎ後も前日の today のまま期限バケットが固定されてしまう
  // ため、日付境界の自動更新を持つ useTodayIso 経由で取得する
  // （GanttView.tsx の表示レンジと同じ理由・同じフックを共有する）。
  const today = useTodayIso();

  const groups = useMemo(
    () =>
      tasks === undefined ? undefined : groupMyTasksByDueDate(tasks, today),
    [tasks, today],
  );

  const projectChips = useMemo(() => {
    if (tasks === undefined) return [];
    const seen = new Set<Id<"projects">>();
    const chips: Doc<"projects">[] = [];
    for (const task of tasks) {
      if (seen.has(task.project)) continue;
      seen.add(task.project);
      const project = projects.find((p) => p._id === task.project);
      if (project !== undefined) chips.push(project);
    }
    return chips.toSorted((a, b) => (a.key < b.key ? -1 : 1));
  }, [tasks, projects]);

  return (
    <main className={s.page}>
      <section className={s.profile}>
        {currentMemberLoading ? (
          <output aria-label="プロフィールを読み込み中">
            <Skeleton className={s.skeletonProfile} />
          </output>
        ) : (
          currentMember !== null && (
            <div className={s.identity}>
              <span className={s.name}>{currentMember.name}</span>
              <span className={s.role}>
                {MEMBER_ROLE_LABELS[currentMember.role]}
              </span>
            </div>
          )
        )}
        {projectChips.length > 0 && (
          <ul className={s.chips}>
            {projectChips.map((project) => (
              <li key={project._id}>
                <Link
                  aria-label={`${project.key}（${project.name}）のカンバンへ`}
                  className={s.chip}
                  onClick={() => selectProject(project._id)}
                  to="/"
                >
                  {project.key}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {groups === undefined ? (
        <output aria-label="担当 Task を読み込み中" className={s.loading}>
          <Skeleton className={s.skeletonPanel} />
        </output>
      ) : groups.length === 0 ? (
        <p className={s.empty}>
          担当している Task がありません。Task
          の詳細画面の「担当者」で自分を選ぶと、ここに表示されます。
          <Link className={`inline-link ${s.emptyLink}`} to="/">
            Task 一覧へ
          </Link>
        </p>
      ) : (
        groups.map((group) => (
          <section className={s.section} key={group.bucket}>
            <h2 className={s.heading}>
              {DUE_BUCKET_LABELS[group.bucket]}
              <span className={s.count}>{group.tasks.length}</span>
            </h2>
            <div className={s.grid}>
              {group.tasks.map((task) => (
                <TaskCard
                  issueNumber={task.issueNumber}
                  key={task._id}
                  projectKey={task.projectKey}
                  showStatus
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
