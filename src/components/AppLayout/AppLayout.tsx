import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { useState } from "react";
import { NavLink, Outlet, useOutletContext } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import {
  type MemberSummary,
  useCurrentMember,
} from "../../hooks/useCurrentMember";
import { convexErrorMessage } from "../../lib/convexErrorMessage";
import { NoMembersNotice } from "../NoMembersNotice/NoMembersNotice";
import { Skeleton } from "../Skeleton/Skeleton";
import s from "./AppLayout.module.css";

// 選択中プロジェクトを session 内で保持するキー。
// 詳細画面へ遷移すると AppLayout はアンマウントされ useState が失われるため、
// 「← 一覧へ」で戻った際に選択を復元できるよう sessionStorage に退避する。
const SELECTED_PROJECT_KEY = "selectedProjectId";

// sessionStorage はプライベートブラウジングやストレージ無効環境で例外を投げうる。
// 選択保持は補助機能のため、失敗時はクラッシュさせずログを残した上でデグレードする
// （CLAUDE.md「サイレント失敗の回避」）。
function readSelectedProject(): Id<"projects"> | null {
  try {
    return sessionStorage.getItem(
      SELECTED_PROJECT_KEY,
    ) as Id<"projects"> | null;
  } catch (err) {
    console.warn(
      "プロジェクト選択の復元に失敗しました（sessionStorage 不可）",
      err,
    );
    return null;
  }
}

function writeSelectedProject(id: Id<"projects">): void {
  try {
    sessionStorage.setItem(SELECTED_PROJECT_KEY, id);
  } catch (err) {
    // 保存できなくても遷移自体は機能する（次回復元できないだけ）。
    console.warn(
      "プロジェクト選択の保存に失敗しました（sessionStorage 不可）",
      err,
    );
  }
}

type AppOutletContext = {
  projects: Doc<"projects">[];
  selected: Doc<"projects">;
  members: MemberSummary[] | undefined;
  currentMember: MemberSummary | null;
};

/** 子ルート（TasksView / IssuesView）から選択中プロジェクトと購読済みメンバーを取り出す。 */
export function useAppOutletContext(): AppOutletContext {
  return useOutletContext<AppOutletContext>();
}

export function AppLayout() {
  const projects = useQuery(api.projects.list, {});
  const { members, currentMember, currentMemberLoading } = useCurrentMember();
  const { signOut } = useAuthActions();
  const [selectedId, setSelectedId] = useState<Id<"projects"> | null>(
    readSelectedProject,
  );
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  function selectProject(id: Id<"projects">) {
    setSelectedId(id);
    writeSelectedProject(id);
  }

  async function handleSignOut() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      await signOut();
      // 成功時は Unauthenticated ゲート（App.tsx）が画面ごと切り替えるため、
      // アンマウント後の setState を避けて signingOut は戻さない。
    } catch (err) {
      // 画面表示（再操作の促し）と console（実例外の調査ログ）の両方に残す
      // （CLAUDE.md「サイレント失敗の回避」。定型文言だけでは原因調査ができない）。
      console.error("ログアウトに失敗しました", err);
      setSignOutError(
        convexErrorMessage(
          err,
          "ログアウトに失敗しました。再度お試しください。",
        ),
      );
      setSigningOut(false);
    }
  }

  // ヘッダー右端のセッション表示。プロジェクト 0 件分岐でも認証済みのため、
  // ログアウト導線は常に維持する（無いと別アカウントへ切り替えられず詰む）。
  const session = (
    <div className={s.session}>
      {currentMember !== null && (
        <span className={s.user}>{currentMember.name}</span>
      )}
      <button
        className={s.logout}
        disabled={signingOut}
        onClick={handleSignOut}
        type="button"
      >
        ログアウト
      </button>
      {signOutError !== null && (
        <p className="actionError" role="alert">
          {signOutError}
        </p>
      )}
    </div>
  );

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
        <header className={s.header}>
          <h1 className={s.title}>Task Manager</h1>
          {session}
        </header>
        <p className="hint">
          プロジェクトがありません。MCP もしくは Convex
          ダッシュボードから作成してください。
        </p>
      </main>
    );
  }

  const selected = projects.find((p) => p._id === selectedId) ?? projects[0];

  return (
    <div className={s.app}>
      <header className={s.header}>
        <h1 className={s.title}>Task Manager</h1>
        <nav className={s.nav}>
          <NavLink className={s.navLink} end to="/">
            Task
          </NavLink>
          <NavLink className={s.navLink} to="/issues">
            Issue
          </NavLink>
        </nav>
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
        {session}
      </header>
      {/* 認証済みでも対応する Member が未リンクだと作成手段が消えるため、
          黙って隠さず理由を案内する（Issue #16 / #1）。/ と /issues の両方を
          ここで一元的にカバーする。members.me 読み込み中は判定できないため
          何も出さない。 */}
      {!currentMemberLoading && currentMember === null && <NoMembersNotice />}
      {/* 画面本体（タスク一覧 / Issue 一覧）は子ルートが描画する。main
          ランドマークは各子ルート（TasksView / IssuesView）側が持つため、
          ここでは main にしない（Issue #17 の ErrorBoundary フォールバックも
          main を持つため、二重にしない）。 */}
      <Outlet context={{ projects, selected, members, currentMember }} />
    </div>
  );
}
