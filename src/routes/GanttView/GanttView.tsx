import { useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { useAppOutletContext } from "../../components/AppLayout/AppLayout";
import { GanttChart } from "../../components/GanttChart/GanttChart";
import { Skeleton } from "../../components/Skeleton/Skeleton";
import { buildGanttModel, todayIso } from "../../lib/gantt";
import s from "./GanttView.module.css";

/**
 * 「今日」のローカル日付。次の日付境界を跨いだら自前のタイマーで更新する。
 * レンダー時評価だけだと、購読データに変化がない限り日跨ぎ後も前日の
 * today でガント（今日線・表示レンジ）が固定されてしまう。
 */
function useToday(): string {
  const [today, setToday] = useState(todayIso);
  useEffect(() => {
    // 次のタイマーは state の変化に依存させず、コールバック内で必ず張り直す。
    // 「発火 → 同値 set（時計後退等で日付が進んでいない）→ 再レンダーなし」でも
    // 連鎖が止まらないようにするため（+1秒は境界僅か手前での発火対策の余裕。
    // 早発火しても次回は現在時刻から翌日境界を再計算するので自己回復する）。
    let id: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const now = new Date();
      const nextMidnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      );
      id = setTimeout(
        () => {
          setToday(todayIso());
          schedule();
        },
        nextMidnight.getTime() - now.getTime() + 1000,
      );
    };
    schedule();
    return () => clearTimeout(id);
  }, []);
  return today;
}

/**
 * ガントタブ本体（Issue #141）。tasks.gantt を購読し、行順・バー範囲・
 * 表示レンジの導出は純粋関数（src/lib/gantt.ts）に委ねる。表示専用で
 * mutation・書き込み導線は置かない。
 */
export function GanttView() {
  const { selected } = useAppOutletContext();
  const issues = useQuery(api.tasks.gantt, { project: selected._id });
  const today = useToday();

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
          開始日・期限日が設定された Task がありません。Issue 一覧から Issue
          を開き、Task の詳細画面の「編集」で開始日・期限日を設定してください。
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
