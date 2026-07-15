import { ActiveIssueStrip } from "../../components/ActiveIssueStrip/ActiveIssueStrip";
import { useAppOutletContext } from "../../components/AppLayout/AppLayout";
import { Board } from "../../components/Board/Board";
import { FilterBar } from "../../components/FilterBar/FilterBar";
import { useFilterParams } from "../../lib/filterParams";
import s from "./TasksView.module.css";

/**
 * Board は status でグルーピング済みのため、Board のフィルタ語彙は
 * priority/assignee のみに閉じる（status フィルタは提供しない。Issue #92）。
 *
 * FilterBar は Board 側の早期 return（board === null）の影響を受けないよう
 * ここで独立に設置する。value/onChange は useFilterParams（URL 外在化）
 * 経由で、Board 内部でも同じ URL を購読する useFilterParams が動くため
 * 両者は常に同じフィルタ状態を見る。
 */
export function TasksView() {
  const { selected, members } = useAppOutletContext();
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
        project={selected._id}
        projectKey={selected.key}
      />
    </main>
  );
}
