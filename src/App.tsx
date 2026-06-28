import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import s from "./App.module.css";
import { Board } from "./components/Board/Board";
import { IssueList } from "./components/IssueList/IssueList";
import { NewIssueForm } from "./components/NewIssueForm/NewIssueForm";

export function App() {
  const projects = useQuery(api.projects.list);
  const members = useQuery(api.members.list);
  const [selectedId, setSelectedId] = useState<Id<"projects"> | null>(null);

  // 認証は未実装（Phase2）のため、暫定的に先頭メンバーを作成者とする。
  const currentMember = members?.[0] ?? null;

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
      {currentMember !== null && (
        <NewIssueForm createdBy={currentMember._id} project={selected._id} />
      )}
      <IssueList
        createdBy={currentMember?._id ?? null}
        project={selected._id}
      />
      <Board project={selected._id} projectKey={selected.key} />
    </main>
  );
}
