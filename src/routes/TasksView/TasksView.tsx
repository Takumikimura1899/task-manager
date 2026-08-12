import { ActiveIssueStrip } from "../../components/ActiveIssueStrip/ActiveIssueStrip";
import { useSelectedProject } from "../../components/AppLayout/AppLayout";
import { Board } from "../../components/Board/Board";
import { FilterBar } from "../../components/FilterBar/FilterBar";
import { EMPTY_FILTER, useFilterParams } from "../../lib/filterParams";
import s from "./TasksView.module.css";

/**
 * Board は status でグルーピング済みのため、Board のフィルタ語彙は
 * priority/assignee のみに閉じる（status フィルタは提供しない。Issue #92）。
 *
 * FilterBar は Board 側の早期 return（board === null）の影響を受けないよう
 * ここで独立に設置する。フィルタ状態の所有者は TasksView のみ（URL 外在化の
 * useFilterParams をここでだけ購読し、Board へは filter/onClearFilter を
 * props で渡す）。FilterBar と Board が同じフィルタ状態を見るのは同一の
 * filter を配っているからであり、Board に useFilterParams を再導入して
 * 二重購読へ戻さないこと。
 */
export function TasksView() {
  const { selected, members } = useSelectedProject();
  const [filter, setFilter] = useFilterParams();

  return (
    <main className={s.page}>
      <ActiveIssueStrip project={selected._id} projectKey={selected.key} />
      <FilterBar
        attributes={["priority", "assignee"]}
        members={members}
        onChange={setFilter}
        value={filter}
      />
      {/* プロジェクト切替時に Board を再生成してローカル state（board /
          syncedRef）を初期化する。key が無いと新データのロード中に旧プロジェクト
          のカードが新しい projectKey で表示され、不正な URL へ遷移する（Issue #74）。 */}
      <Board
        key={selected._id}
        filter={filter}
        onClearFilter={() => setFilter(EMPTY_FILTER)}
        project={selected._id}
        projectKey={selected.key}
      />
    </main>
  );
}
