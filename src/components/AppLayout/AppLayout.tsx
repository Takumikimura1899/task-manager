import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { useState } from "react";
import { NavLink, Outlet, useMatch, useOutletContext } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import {
  type CurrentMember,
  type MemberSummary,
  useCurrentMember,
} from "../../hooks/useCurrentMember";
import { reportConvexError } from "../../lib/convexErrorMessage";
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
  /**
   * プロジェクトが0件のときは null（My Page はプロジェクトスコープを
   * 持たないため、この場合でも描画される唯一の子ルート）。
   * Task/Issue/Gantt など selected を要求するビューは
   * useAppOutletContext ではなく useSelectedProject を使い、
   * non-null を確定させたうえで取得する。
   */
  selected: Doc<"projects"> | null;
  members: MemberSummary[] | undefined;
  currentMember: CurrentMember | null;
  /** currentMember が null のとき「未ロード」か「未リンク」かを区別する。 */
  currentMemberLoading: boolean;
  selectProject: (id: Id<"projects">) => void;
};

/** 子ルート（TasksView / IssuesView / GanttView / MyPageView）から選択中プロジェクトと購読済みメンバーを取り出す。 */
export function useAppOutletContext(): AppOutletContext {
  return useOutletContext<AppOutletContext>();
}

/**
 * プロジェクトスコープのビュー（TasksView / IssuesView / GanttView）専用の
 * 非null 化アサーション。AppLayout はプロジェクトが0件のときこれらのルートを
 * 描画しない（0件表示は AppLayout 自前のヒントに委ねる。My Page だけが
 * 0件でも描画される）ため、selected が null なのは到達しないはずの分岐。
 * 到達したら握り潰さず例外にする（CLAUDE.md「サイレント失敗の回避」）。
 */
function assertSelectedProject(
  selected: Doc<"projects"> | null,
): asserts selected is Doc<"projects"> {
  if (selected === null) {
    throw new Error(
      "selected プロジェクトが存在しません（到達しないはずの分岐）",
    );
  }
}

/**
 * プロジェクトスコープのビュー（TasksView / IssuesView / GanttView）専用の
 * Outlet context フック。useAppOutletContext + assertSelectedProject の
 * 組み合わせが3ビューへ逐語重複していたため、selected を非null で返す
 * 形にここへ集約した（呼び出し側は selected の null チェックを書かない）。
 */
export function useSelectedProject(): Omit<AppOutletContext, "selected"> & {
  selected: Doc<"projects">;
} {
  const { selected, ...rest } = useAppOutletContext();
  assertSelectedProject(selected);
  return { ...rest, selected };
}

export function AppLayout() {
  const projects = useQuery(api.projects.list, {});
  const { members, currentMember, currentMemberLoading } = useCurrentMember();
  const { signOut } = useAuthActions();
  // My Page（/mypage）表示中はプロジェクト選択が効かないため、効かない操作を見せない。
  // 旧パス /my-tasks は <Navigate>（副作用ベースの遷移）で /mypage へリダイレクト
  // されるため、初回コミットの1フレームだけ pathname が /my-tasks のまま残る
  // （AppLayout は /my-tasks も子ルートとして持つため、この間も AppLayout 自体は
  // 通常どおり描画される）。その一瞬だけ picker が再出現するのを防ぐため、
  // リダイレクト元のパスもここで判定に含める。
  // 短絡評価で2つ目の useMatch がスキップされないよう、それぞれ独立した
  // 変数へ受けてから OR を取る（|| の右辺を直接 useMatch(...) にすると、
  // 左辺が真の render だけ呼び出しがスキップされ、レンダーごとに呼ばれる
  // フック数が変わって Rules of Hooks 違反になる）。
  const matchesMyPage = useMatch("/mypage") !== null;
  const matchesMyTasksRedirect = useMatch("/my-tasks") !== null;
  const onMyPage = matchesMyPage || matchesMyTasksRedirect;
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
      // 画面表示（再操作の促し）と console（想定外の例外の調査ログ）の両方に
      // 残す（CLAUDE.md「サイレント失敗の回避」。定型文言だけでは原因調査が
      // できない）。ログ出力は reportConvexError に集約している
      // （convexErrorMessage.ts・監査 H-1）。
      setSignOutError(
        reportConvexError(
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
          <output aria-label="プロジェクト選択を読み込み中">
            <Skeleton className={s.skeletonPicker} />
          </output>
        </header>
        <output aria-label="プロジェクトを読み込み中" className={s.loading}>
          <Skeleton className={s.skeletonPanel} />
          <Skeleton className={s.skeletonBoard} />
        </output>
      </main>
    );
  }

  const hasProjects = projects.length > 0;
  // hasProjects が false のとき、selected（プロジェクトスコープ選択）は
  // 用意できない。Task/Issue/Gantt はプロジェクトが無いと描画できないため
  // 下記でヒント表示に差し替えるが、My Page は全プロジェクト横断ビューで
  // selected に依存しないため、0件でも通常どおりヘッダー＋Outlet を描画する
  // （0件時に /mypage へ到達できず My Page ナビ自体も消えていた不具合の修正）。
  const selected = hasProjects
    ? (projects.find((p) => p._id === selectedId) ?? projects[0])
    : null;

  return (
    <div className={s.app}>
      <header className={s.header}>
        {/* 左＝プロジェクトスコープ群（Task/Issue/Gantt＋プロジェクト選択）。 */}
        <div className={s.left}>
          <h1 className={s.title}>Task Manager</h1>
          {/* プロジェクトが0件だと Task/Issue/Gantt は汎用ヒントしか出せない
              （selected が無く描画できない）ため、効かない操作を見せない
              方針（プロジェクト選択と同じ）でタブ自体を隠す。 */}
          {selected !== null && (
            <nav className={s.nav}>
              <NavLink className={s.navLink} end to="/">
                Task
              </NavLink>
              <NavLink className={s.navLink} to="/issues">
                Issue
              </NavLink>
              <NavLink className={s.navLink} to="/gantt">
                Gantt
              </NavLink>
            </nav>
          )}
          {selected !== null && !onMyPage && (
            <label className={s.picker}>
              プロジェクト
              <select
                className={s.select}
                onChange={(e) =>
                  selectProject(e.target.value as Id<"projects">)
                }
                value={selected._id}
              >
                {projects.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.key} — {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {/* 右＝個人スコープ（My Page＋ユーザー名＋ログアウト）。プロジェクト
            0件でも認証済みであることに変わりはないため常に表示する
            （無いと My Page にも別アカウントへの切替にも到達できず詰む）。 */}
        <div className={s.right}>
          <NavLink className={s.navLink} to="/mypage">
            My Page
          </NavLink>
          {session}
        </div>
      </header>
      {/* 認証済みでも対応する Member が未リンクだと作成手段が消えるため、
          黙って隠さず理由を案内する（Issue #16 / #1）。/ と /issues の両方を
          ここで一元的にカバーする。members.me 読み込み中は判定できないため
          何も出さない。 */}
      {!currentMemberLoading && currentMember === null && <NoMembersNotice />}
      {hasProjects || onMyPage ? (
        // 画面本体（タスク一覧 / Issue 一覧 / My Page）は子ルートが描画する。main
        // ランドマークは各子ルート（TasksView / IssuesView / MyPageView）側が
        // 持つため、ここでは main にしない（Issue #17 の ErrorBoundary
        // フォールバックも main を持つため、二重にしない）。
        <Outlet
          context={{
            projects,
            selected,
            members,
            currentMember,
            currentMemberLoading,
            selectProject,
          }}
        />
      ) : (
        // このブランチだけ子ルート（main ランドマークを持つ）が描画されない
        // ため、他の空状態（TaskDetail.tsx 等）と同様にここで main を持つ。
        <main className="hint">
          プロジェクトがありません。MCP もしくは Convex
          ダッシュボードから作成してください。
        </main>
      )}
    </div>
  );
}
