import { ActiveIssueStrip } from "../../components/ActiveIssueStrip/ActiveIssueStrip";
import { useAppOutletContext } from "../../components/AppLayout/AppLayout";
import { Board } from "../../components/Board/Board";
import s from "./TasksView.module.css";

export function TasksView() {
  const { selected } = useAppOutletContext();

  return (
    <main className={s.page}>
      <ActiveIssueStrip project={selected._id} projectKey={selected.key} />
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
