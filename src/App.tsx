import { AuthLoading, Authenticated, Unauthenticated } from "convex/react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout/AppLayout";
import { DetailErrorBoundary } from "./components/ErrorBoundary/DetailErrorBoundary";
import { ErrorBoundary } from "./components/ErrorBoundary/ErrorBoundary";
import { GanttView } from "./routes/GanttView/GanttView";
import { IssueDetail } from "./routes/IssueDetail/IssueDetail";
import { IssuesView } from "./routes/IssuesView/IssuesView";
import { MyPageView } from "./routes/MyPageView/MyPageView";
import { NotFound } from "./routes/NotFound/NotFound";
import { ProjectMembers } from "./routes/ProjectMembers/ProjectMembers";
import { AuthLoadingScreen, SignIn } from "./routes/SignIn/SignIn";
import { TaskDetail } from "./routes/TaskDetail/TaskDetail";
import { TasksView } from "./routes/TasksView/TasksView";

// 各ルートを ErrorBoundary で包み、Convex useQuery の throw 等による
// 全画面白画面クラッシュを防ぐ（Issue #17）。ルート単位にすることで
// 画面遷移すれば境界ごと作り直され、エラー状態を持ち越さない。
//
// 認証ゲート（Issue #1）はルート個別ではなく App レベルで行う。
// IssueDetail / TaskDetail / ProjectMembers は AppLayout 外のルートのため、
// AppLayout 内にゲートを置くと詳細画面が未認証のまま開けてしまう。
export function App() {
  return (
    <>
      <AuthLoading>
        <AuthLoadingScreen />
      </AuthLoading>
      <Unauthenticated>
        <ErrorBoundary>
          <SignIn />
        </ErrorBoundary>
      </Unauthenticated>
      <Authenticated>
        <AppRoutes />
      </Authenticated>
    </>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        element={
          <ErrorBoundary>
            <AppLayout />
          </ErrorBoundary>
        }
      >
        <Route
          element={
            <ErrorBoundary>
              <TasksView />
            </ErrorBoundary>
          }
          path="/"
        />
        <Route
          element={
            <ErrorBoundary>
              <IssuesView />
            </ErrorBoundary>
          }
          path="/issues"
        />
        <Route
          element={
            <ErrorBoundary>
              <GanttView />
            </ErrorBoundary>
          }
          path="/gantt"
        />
        <Route
          element={
            <ErrorBoundary>
              <MyPageView />
            </ErrorBoundary>
          }
          path="/mypage"
        />
        {/* 旧パス（改名前の URL）を保護する互換リダイレクト */}
        <Route element={<Navigate replace to="/mypage" />} path="/my-tasks" />
      </Route>
      <Route
        element={
          <ErrorBoundary>
            <DetailErrorBoundary backTo="/issues">
              <IssueDetail />
            </DetailErrorBoundary>
          </ErrorBoundary>
        }
        path="/:projectKey/issues/:number"
      />
      <Route
        element={
          <ErrorBoundary>
            <DetailErrorBoundary backTo="/">
              <TaskDetail />
            </DetailErrorBoundary>
          </ErrorBoundary>
        }
        path="/:projectKey/tasks/:number"
      />
      <Route
        element={
          <ErrorBoundary>
            <DetailErrorBoundary backTo="/">
              <ProjectMembers />
            </DetailErrorBoundary>
          </ErrorBoundary>
        }
        path="/:projectKey/settings/members"
      />
      {/* 未定義 URL のフォールバック。空白画面を防ぐ（Issue #16） */}
      <Route element={<NotFound />} path="*" />
    </Routes>
  );
}
