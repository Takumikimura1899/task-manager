import { useQuery } from "convex/react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { useAppOutletContext } from "../../components/AppLayout/AppLayout";
import { GanttChart } from "../../components/GanttChart/GanttChart";
import { Skeleton } from "../../components/Skeleton/Skeleton";
import { buildGanttModel, todayIso } from "../../lib/gantt";
import s from "./GanttView.module.css";

/**
 * ガントタブ本体（Issue #141）。tasks.gantt を購読し、行順・バー範囲・
 * 表示レンジの導出は純粋関数（src/lib/gantt.ts）に委ねる。表示専用で
 * mutation・書き込み導線は置かない。
 *
 * today はレンダーごとに評価し、useMemo の依存に含める（日付が変わる
 * タイミング＝日跨ぎでモデルを再計算するため）。
 */
export function GanttView() {
  const { selected } = useAppOutletContext();
  const issues = useQuery(api.tasks.gantt, { project: selected._id });
  const today = todayIso();

  const model = useMemo(
    () => (issues === undefined ? undefined : buildGanttModel(issues, today)),
    [issues, today],
  );

  return (
    <main className={s.page}>
      {model === undefined ? (
        <output aria-label="ガントを読み込み中" className={s.loading}>
          <Skeleton className={s.skeletonPanel} />
        </output>
      ) : model.rows.length === 0 ? (
        <p className={s.empty}>
          開始日・期限日が設定された Task がありません。Issue 一覧から Task
          を開き、「編集」で開始日・期限日を設定してください。
          <Link className={`inline-link ${s.emptyLink}`} to="/issues">
            Issue 一覧へ
          </Link>
        </p>
      ) : (
        <>
          {(model.clamped.past || model.clamped.future) && (
            <p className="hint">
              表示範囲は今日の前後に限定しています。範囲外の Task
              は端に寄せて表示しています。
            </p>
          )}
          <GanttChart model={model} projectKey={selected.key} />
        </>
      )}
    </main>
  );
}
