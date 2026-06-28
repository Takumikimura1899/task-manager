import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import s from "./App.module.css";
import { Board } from "./components/Board/Board";

export function App() {
  const projects = useQuery(api.projects.list);
  const [selectedId, setSelectedId] = useState<Id<"projects"> | null>(null);

  if (projects === undefined) {
    return <p className="hint">読み込み中…</p>;
  }

  if (projects.length === 0) {
    return (
      <main className={s.app}>
        <h1 className={s.title}>Task Manager</h1>
        <p className="hint">
          プロジェクトがありません。MCP もしくは Convex
          ダッシュボードから作成してください。
        </p>
      </main>
    );
  }

  const selected = projects.find((p) => p._id === selectedId) ?? projects[0];

  return (
    <main className={s.app}>
      <header className={s.header}>
        <h1 className={s.title}>Task Manager</h1>
        <label className={s.picker}>
          プロジェクト
          <select
            className={s.select}
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
