import { useEffect, useState } from "react";
import { todayIso } from "../lib/gantt";

/**
 * 「今日」のローカル日付（YYYY-MM-DD）を state 化し、日付境界を跨いだら
 * 自前のタイマーで更新するフック。レンダー時に todayIso() を直接評価する
 * だけだと、購読データに変化がない限り日跨ぎ後も前日の値のまま固定されて
 * しまう（GanttView の表示レンジ・MyPageView の期限バケットの両方がこの
 * 問題を持っていたため共通化した）。
 */
export function useTodayIso(): string {
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

  useEffect(() => {
    // バックグラウンドタブは setTimeout がスロットリング/凍結されうるため、
    // 単一タイマーだけでは日跨ぎの発火が遅れることがある（レビュー指摘）。
    // タブがアクティブへ復帰した瞬間に todayIso() を再評価するフォール
    // バックを設け、ずれていれば追いつかせる（一致していれば setState しない）。
    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      setToday((prev) => {
        const current = todayIso();
        return prev === current ? prev : current;
      });
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  return today;
}
