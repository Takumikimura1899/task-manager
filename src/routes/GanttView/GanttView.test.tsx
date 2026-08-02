import { render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import type { GanttIssueData, GanttTaskData } from "../../lib/gantt";
import { GanttView } from "./GanttView";

/**
 * GanttView は tasks.gantt をこの1箇所だけで購読し、購読値を
 * buildGanttModel（純粋関数・src/lib/gantt.test.ts で検証済み）へ渡して
 * GanttChart に描画を委ねる。ここではローディング・空状態・購読値の反映・
 * クランプ時ヒント文言の出し分けを検証する。
 * Convex（useQuery）は外部依存のためモックし、useAppOutletContext は
 * IssuesView.test.tsx と同様に実物の <Outlet context> 経由で注入する。
 *
 * buildGanttModel は呼び出し時点の実日付（todayIso()）に依存するため、
 * 表示レンジの算出が決定的になるよう各テストでシステム時刻を固定する。
 */

const mocks = vi.hoisted(() => ({
  issues: undefined as unknown,
}));

vi.mock("convex/react", () => ({
  useQuery: () => mocks.issues,
}));

const project = {
  _id: "project_1" as Id<"projects">,
  _creationTime: 1000,
  key: "TASK",
  name: "タスク管理",
  nextTaskNumber: 1,
  nextIssueNumber: 1,
} as Doc<"projects">;

const createTask = (overrides: Partial<GanttTaskData> = {}): GanttTaskData => ({
  _id: "task_1",
  number: 1,
  title: "タスクA",
  status: "todo",
  startDate: "2026-08-01",
  dueDate: "2026-08-05",
  ...overrides,
});

const createIssue = (
  overrides: Partial<GanttIssueData> = {},
): GanttIssueData => ({
  _id: "issue_1",
  number: 1,
  title: "課題A",
  tasks: [createTask()],
  ...overrides,
});

const renderGanttView = () =>
  render(
    <MemoryRouter initialEntries={["/gantt"]}>
      <Routes>
        <Route element={<Outlet context={{ selected: project }} />}>
          <Route element={<GanttView />} path="/gantt" />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  mocks.issues = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GanttView のローディング表示", () => {
  it("読み込み中はガントを読み込み中のスケルトンを表示する", () => {
    renderGanttView();

    expect(
      screen.getByRole("status", { name: "ガントを読み込み中" }),
    ).toBeInTheDocument();
  });
});

describe("GanttView の空状態", () => {
  it("表示対象の Issue が0件なら案内文言と「Issue 一覧へ」リンクを表示する", () => {
    mocks.issues = [];
    renderGanttView();

    expect(
      screen.queryByRole("status", { name: "ガントを読み込み中" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/開始日・期限日が設定された Task がありません/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Issue 一覧へ" })).toHaveAttribute(
      "href",
      "/issues",
    );
  });
});

describe("GanttView の購読値の反映", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 3)); // 2026-08-03（レンジ算出を決定的にする）
  });

  it("issues を GanttChart へ渡し、Issue/Task の行が描画される", () => {
    mocks.issues = [
      createIssue({
        _id: "issue_1",
        number: 3,
        title: "課題A",
        tasks: [
          createTask({
            _id: "task_1",
            number: 9,
            title: "タスクA",
            startDate: "2026-07-30",
            dueDate: "2026-08-05",
          }),
        ],
      }),
    ];
    renderGanttView();

    expect(
      screen.getByRole("link", { name: "Issue #3 課題A" }),
    ).toHaveAttribute("href", "/TASK/issues/3");
    expect(
      screen.getByRole("link", { name: "TASK-9 タスクA" }),
    ).toHaveAttribute("href", "/TASK/tasks/9");
  });

  it("表示レンジがクランプされた場合、範囲外を示すヒント文言を表示する", () => {
    mocks.issues = [
      createIssue({
        tasks: [createTask({ startDate: null, dueDate: "2099-12-31" })],
      }),
    ];
    renderGanttView();

    expect(
      screen.getByText(
        "表示範囲は今日の前後に限定しています。範囲外の Task は端に寄せて表示しています。",
      ),
    ).toBeInTheDocument();
  });

  it("表示レンジがクランプされていない場合、ヒント文言を表示しない", () => {
    mocks.issues = [
      createIssue({
        tasks: [createTask({ startDate: "2026-08-01", dueDate: "2026-08-05" })],
      }),
    ];
    renderGanttView();

    expect(
      screen.queryByText(/表示範囲は今日の前後に限定しています/),
    ).not.toBeInTheDocument();
  });
});
