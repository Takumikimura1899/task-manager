import { AuthLoading, Authenticated, Unauthenticated } from "convex/react";
import { Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout/AppLayout";
import { ErrorBoundary } from "./components/ErrorBoundary/ErrorBoundary";
import { IssueDetail } from "./routes/IssueDetail/IssueDetail";
import { IssuesView } from "./routes/IssuesView/IssuesView";
import { NotFound } from "./routes/NotFound/NotFound";
import { AuthLoadingScreen, SignIn } from "./routes/SignIn/SignIn";
import { TaskDetail } from "./routes/TaskDetail/TaskDetail";
import { TasksView } from "./routes/TasksView/TasksView";

// 各ルートを ErrorBoundary で包み、Convex useQuery の throw 等による
// 全画面白画面クラッシュを防ぐ（Issue #17）。ルート単位にすることで
// 画面遷移すれば境界ごと作り直され、エラー状態を持ち越さない。
//
// 認証ゲート（Issue #1）はルート個別ではなく App レベルで行う。
// IssueDetail / TaskDetail は AppLayout 外のルートのため、AppLayout 内に
// ゲートを置くと詳細画面が未認証のまま開けてしまう。
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
      </Route>
      <Route
        element={
          <ErrorBoundary>
            <IssueDetail />
          </ErrorBoundary>
        }
        path="/:projectKey/issues/:number"
      />
      <Route
        element={
          <ErrorBoundary>
            <TaskDetail />
          </ErrorBoundary>
        }
        path="/:projectKey/tasks/:number"
      />
      {/* 未定義 URL のフォールバック。空白画面を防ぐ（Issue #16） */}
      <Route element={<NotFound />} path="*" />
    </Routes>
  );
}
