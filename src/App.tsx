import { Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary/ErrorBoundary";
import { Home } from "./routes/Home/Home";
import { IssueDetail } from "./routes/IssueDetail/IssueDetail";
import { TaskDetail } from "./routes/TaskDetail/TaskDetail";

// 各ルートを ErrorBoundary で包み、Convex useQuery の throw 等による
// 全画面白画面クラッシュを防ぐ（Issue #17）。ルート単位にすることで
// 画面遷移すれば境界ごと作り直され、エラー状態を持ち越さない。
export function App() {
  return (
    <Routes>
      <Route
        element={
          <ErrorBoundary>
            <Home />
          </ErrorBoundary>
        }
        path="/"
      />
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
    </Routes>
  );
}
