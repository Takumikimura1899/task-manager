import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";

// §5 の固定6状態に対する表示ラベル
const STATUS_LABELS: Record<Doc<"tasks">["status"], string> = {
  backlog: "バックログ",
  todo: "未着手",
  in_progress: "進行中",
  in_review: "レビュー中",
  done: "完了",
  canceled: "キャンセル",
};

const PRIORITY_LABELS: Record<Doc<"tasks">["priority"], string> = {
  none: "—",
  low: "低",
  medium: "中",
  high: "高",
  urgent: "緊急",
};

function TaskCard({
  task,
  projectKey,
}: {
  task: Doc<"tasks">;
  projectKey: string;
}) {
  return (
    <article className="card">
      <span className="card__ref">
        {projectKey}-{task.number}
      </span>
      <h3 className="card__title">{task.title}</h3>
      <span className="card__priority">
        優先度: {PRIORITY_LABELS[task.priority]}
      </span>
    </article>
  );
}

function Board({
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
    <div className="board">
      {columns.map((column) => (
        <section className="column" key={column.status}>
          <header className="column__header">
            {STATUS_LABELS[column.status]}
            <span className="column__count">{column.tasks.length}</span>
          </header>
          <div className="column__body">
            {column.tasks.map((task) => (
              <TaskCard key={task._id} projectKey={projectKey} task={task} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function App() {
  const projects = useQuery(api.projects.list);
  const [selectedId, setSelectedId] = useState<Id<"projects"> | null>(null);

  if (projects === undefined) {
    return <p className="hint">読み込み中…</p>;
  }

  if (projects.length === 0) {
    return (
      <main className="app">
        <h1>Task Manager</h1>
        <p className="hint">
          プロジェクトがありません。MCP もしくは Convex
          ダッシュボードから作成してください。
        </p>
      </main>
    );
  }

  const selected = projects.find((p) => p._id === selectedId) ?? projects[0];

  return (
    <main className="app">
      <header className="app__header">
        <h1>Task Manager</h1>
        <label className="project-picker">
          プロジェクト
          <select
            onChange={(e) => setSelectedId(e.target.value as Id<"projects">)}
            value={selected._id}
          >
            {projects.map((p) => (
              <option key={p._id} value={p._id}>
                {p.key} — {p.name}
              </option>
            ))}
          </select>
        </label>
      </header>
      <Board project={selected._id} projectKey={selected.key} />
    </main>
  );
}
