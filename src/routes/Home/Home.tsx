import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Board } from "../../components/Board/Board";
import { IssueList } from "../../components/IssueList/IssueList";
import { NewIssueForm } from "../../components/NewIssueForm/NewIssueForm";
import { NoMembersNotice } from "../../components/NoMembersNotice/NoMembersNotice";
import { Skeleton } from "../../components/Skeleton/Skeleton";
import s from "./Home.module.css";

// 選択中プロジェクトを session 内で保持するキー。
// 詳細画面へ遷移すると Home はアンマウントされ useState が失われるため、
// 「← 一覧へ」で戻った際に選択を復元できるよう sessionStorage に退避する。
const SELECTED_PROJECT_KEY = "selectedProjectId";

// sessionStorage はプライベートブラウジングやストレージ無効環境で例外を投げうる。
// 選択保持は補助機能のため、失敗時はクラッシュさせず黙ってデグレードする。
function readSelectedProject(): Id<"projects"> | null {
  try {
    return sessionStorage.getItem(
      SELECTED_PROJECT_KEY,
    ) as Id<"projects"> | null;
  } catch {
    return null;
  }
}

function writeSelectedProject(id: Id<"projects">): void {
  try {
    sessionStorage.setItem(SELECTED_PROJECT_KEY, id);
  } catch {
    // 保存できなくても遷移自体は機能する（次回復元できないだけ）。
  }
}

export function Home() {
  const projects = useQuery(api.projects.list);
  const members = useQuery(api.members.list);
  const [selectedId, setSelectedId] = useState<Id<"projects"> | null>(
    readSelectedProject,
  );

  function selectProject(id: Id<"projects">) {
    setSelectedId(id);
    writeSelectedProject(id);
  }

  // 認証は未実装（Phase2）のため、暫定的に先頭メンバーを作成者とする。
  const currentMember = members?.[0] ?? null;

  // 読み込み中もタイトルと画面枠を維持し、プロジェクト選択・Issue 一覧・
  // ボードが入る領域をスケルトンで示す（Issue #29：全画面差し替えをやめる）。
  if (projects === undefined) {
    return (
      <main className={s.app}>
        <header className={s.header}>
          <h1 className={s.title}>Task Manager</h1>
          <Skeleton className={s.skeletonPicker} />
        </header>
        <output aria-label="プロジェクトを読み込み中" className={s.loading}>
          <Skeleton className={s.skeletonPanel} />
          <Skeleton className={s.skeletonBoard} />
        </output>
      </main>
    );
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
            onChange={(e) => selectProject(e.target.value as Id<"projects">)}
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
      {currentMember !== null ? (
        <NewIssueForm createdBy={currentMember._id} project={selected._id} />
      ) : (
        // メンバー 0 件では作成手段が消えるため、黙って隠さず理由を案内する
        // （Issue #16）。members 読み込み中（undefined）は判定できないため何も出さない。
        members !== undefined && <NoMembersNotice />
      )}
      <IssueList
        createdBy={currentMember?._id ?? null}
        project={selected._id}
        projectKey={selected.key}
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
