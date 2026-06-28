import { Route, Routes } from "react-router-dom";
import { Home } from "./routes/Home/Home";
import { IssueDetail } from "./routes/IssueDetail/IssueDetail";
import { TaskDetail } from "./routes/TaskDetail/TaskDetail";

export function App() {
  return (
    <Routes>
      <Route element={<Home />} path="/" />
      <Route element={<IssueDetail />} path="/:projectKey/issues/:number" />
      <Route element={<TaskDetail />} path="/:projectKey/tasks/:number" />
    </Routes>
  );
}
