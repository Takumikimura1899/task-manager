import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { TaskCard } from "../TaskCard/TaskCard";
import s from "./Board.module.css";

// §5 の固定6状態に対する表示ラベル
const STATUS_LABELS: Record<Doc<"tasks">["status"], string> = {
  backlog: "バックログ",
  todo: "未着手",
  in_progress: "進行中",
  in_review: "レビュー中",
  done: "完了",
  canceled: "キャンセル",
};

export function Board({
  project,
  projectKey,
}: {
  project: Id<"projects">;
  projectKey: string;
}) {
  const columns = useQuery(api.tasks.board, { project });

  if (columns === undefined) {
    return <p className="hint">読み込み中…</p>;
  }

  return (
    <div className={s.board}>
      {columns.map((column) => (
        <section className={s.column} key={column.status}>
          <header className={s.header}>
            {STATUS_LABELS[column.status]}
            <span className={s.count}>{column.tasks.length}</span>
          </header>
          <div className={s.body}>
            {column.tasks.map((task) => (
              <TaskCard key={task._id} projectKey={projectKey} task={task} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
