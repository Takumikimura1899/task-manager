import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { GanttBar, GanttModel, GanttRow } from "../../lib/gantt";
import { GanttChart } from "./GanttChart";
import s from "./GanttChart.module.css";

/**
 * GanttChart は購読を持たない純表示コンポーネント（Issue #141 PR2）。
 * 行順・バー範囲・表示レンジの算出自体は src/lib/gantt.test.ts で検証済みのため、
 * ここでは固定の GanttModel を props 注入し、DOM への写像（Link href・
 * gridColumn・done クラス・aria-label 文言）だけを検証する。
 */

// createDays(10) は 2026-08-01 起点の連番日付（index=i → 2026-08-0{i+1}）。
// Issue 行の期間文言（days[] からの実日付引き）を固定値で検証するために使う。
const createDays = (count: number): GanttModel["days"] =>
  Array.from({ length: count }, (_, i) => ({
    date: `2026-08-${String(i + 1).padStart(2, "0")}`,
    isWeekStart: false,
  }));

const createModel = (
  rows: GanttRow[],
  overrides: Partial<Omit<GanttModel, "rows">> = {},
): GanttModel => ({
  days: createDays(10),
  todayIndex: 0,
  clamped: { past: false, future: false },
  rows,
  ...overrides,
});

const DEFAULT_POINT_BAR: GanttBar = {
  type: "point",
  index: 0,
  outOfRange: false,
};

const createIssueRow = (
  overrides: Partial<Extract<GanttRow, { kind: "issue" }>> = {},
): GanttRow => ({
  kind: "issue",
  id: "issue_1",
  number: 1,
  title: "課題",
  bar: DEFAULT_POINT_BAR,
  startDate: "2026-08-01",
  dueDate: "2026-08-01",
  ...overrides,
});

const createTaskRow = (
  overrides: Partial<Extract<GanttRow, { kind: "task" }>> = {},
): GanttRow => ({
  kind: "task",
  id: "task_1",
  number: 1,
  title: "タスク",
  status: "todo",
  bar: DEFAULT_POINT_BAR,
  startDate: "2026-08-01",
  dueDate: null,
  ...overrides,
});

const renderGanttChart = (model: GanttModel, projectKey = "TASK") =>
  render(
    <MemoryRouter>
      <GanttChart model={model} projectKey={projectKey} />
    </MemoryRouter>,
  );

describe("GanttChart のラベル・バー Link", () => {
  it("Issue/Task 行はラベルとバーが同一の遷移先 href を持つ", () => {
    const model = createModel([
      createIssueRow({ id: "issue_1", number: 5, title: "課題A" }),
      createTaskRow({ id: "task_1", number: 7, title: "タスクA" }),
    ]);
    renderGanttChart(model, "TASK");

    const issueLabel = screen.getByRole("link", { name: "Issue #5 課題A" });
    const issueBar = screen.getByRole("link", {
      name: "Issue #5 課題A 開始日 2026-08-01 から 期限日 2026-08-01",
    });
    expect(issueLabel).toHaveAttribute("href", "/TASK/issues/5");
    expect(issueBar).toHaveAttribute("href", "/TASK/issues/5");

    const taskLabel = screen.getByRole("link", { name: "TASK-7 タスクA" });
    const taskBar = screen.getByRole("link", {
      name: "TASK-7 タスクA 開始日 2026-08-01(期限日なし)",
    });
    expect(taskLabel).toHaveAttribute("href", "/TASK/tasks/7");
    expect(taskBar).toHaveAttribute("href", "/TASK/tasks/7");
  });
});

describe("GanttChart のヘッダー軸ラベル", () => {
  it("週境界（月曜）が1件も無いレンジでも、先頭列(index 0)にラベルを1つ出す", () => {
    const days: GanttModel["days"] = [
      { date: "2026-08-04", isWeekStart: false },
      { date: "2026-08-05", isWeekStart: false },
    ];
    const model = createModel([createTaskRow()], { days });
    const { container } = renderGanttChart(model);

    const headerCells = container.querySelectorAll('[class*="headerCell"]');
    expect(headerCells).toHaveLength(1);
    expect(headerCells[0]).toHaveTextContent("8/4");
  });

  it("先頭列が週境界の場合はラベルを重複させない", () => {
    const days: GanttModel["days"] = [
      { date: "2026-08-03", isWeekStart: true },
      { date: "2026-08-04", isWeekStart: false },
      { date: "2026-08-10", isWeekStart: true },
    ];
    const model = createModel([createTaskRow()], { days });
    const { container } = renderGanttChart(model);

    const headerCells = container.querySelectorAll('[class*="headerCell"]');
    expect(Array.from(headerCells).map((el) => el.textContent)).toEqual([
      "8/3",
      "8/10",
    ]);
  });
});

describe("GanttChart のバー配置（gridColumn）", () => {
  it("range バーは gridColumn に startIndex+2 / endIndex+3 を設定する", () => {
    const model = createModel([
      createTaskRow({
        startDate: "2026-08-03",
        dueDate: "2026-08-06",
        bar: {
          type: "range",
          startIndex: 2,
          endIndex: 5,
          clippedStart: false,
          clippedEnd: false,
        },
      }),
    ]);
    renderGanttChart(model);

    const bar = screen.getByRole("link", {
      name: "TASK-1 タスク 開始日 2026-08-03 から 期限日 2026-08-06",
    });
    expect(bar).toHaveStyle({ gridColumn: "4 / 8" });
  });

  it("point バーは gridColumn に index+2 を設定する", () => {
    const model = createModel([
      createTaskRow({ bar: { type: "point", index: 3, outOfRange: false } }),
    ]);
    renderGanttChart(model);

    const bar = screen.getByRole("link", {
      name: "TASK-1 タスク 開始日 2026-08-01(期限日なし)",
    });
    expect(bar).toHaveStyle({ gridColumn: "5" });
  });
});

describe("GanttChart の outOfRange 視覚表示", () => {
  it("point バーが outOfRange の場合のみ outOfRange クラスを付与する", () => {
    const model = createModel([
      createTaskRow({
        id: "task_out",
        number: 1,
        bar: { type: "point", index: 9, outOfRange: true },
      }),
      createTaskRow({
        id: "task_in",
        number: 2,
        bar: { type: "point", index: 3, outOfRange: false },
      }),
    ]);
    renderGanttChart(model);

    const outOfRangeBar = screen.getByRole("link", {
      name: /TASK-1 タスク.*表示範囲外まで継続/,
    });
    const inRangeBar = screen.getByRole("link", {
      name: "TASK-2 タスク 開始日 2026-08-01(期限日なし)",
    });
    expect(outOfRangeBar).toHaveClass(s.outOfRange);
    expect(inRangeBar).not.toHaveClass(s.outOfRange);
  });
});

describe("GanttChart の done 表示", () => {
  it("status=done の Task 行はラベル・バーに done クラスを付与し、他ステータスには付与しない", () => {
    const model = createModel([
      createTaskRow({
        id: "task_done",
        number: 1,
        title: "完了タスク",
        status: "done",
      }),
      createTaskRow({
        id: "task_todo",
        number: 2,
        title: "未完了タスク",
        status: "todo",
      }),
    ]);
    renderGanttChart(model);

    // done はアクセシブルネームにも状態語(完了)が付く(opacity だけでは
    // スクリーンリーダーに状態が伝わらないため)
    const doneLabel = screen.getByRole("link", {
      name: "TASK-1 完了タスク(完了)",
    });
    const doneBar = screen.getByRole("link", {
      name: "TASK-1 完了タスク 開始日 2026-08-01(期限日なし)(完了)",
    });
    expect(doneLabel).toHaveClass(s.done);
    expect(doneBar).toHaveClass(s.done);

    const todoLabel = screen.getByRole("link", { name: "TASK-2 未完了タスク" });
    const todoBar = screen.getByRole("link", {
      name: "TASK-2 未完了タスク 開始日 2026-08-01(期限日なし)",
    });
    expect(todoLabel).not.toHaveClass(s.done);
    expect(todoBar).not.toHaveClass(s.done);
  });
});

describe("GanttChart の aria-label（Task 行）", () => {
  it.each([
    {
      name: "range: 開始日〜期限日を併記する",
      startDate: "2026-08-03",
      dueDate: "2026-08-06",
      bar: {
        type: "range",
        startIndex: 2,
        endIndex: 5,
        clippedStart: false,
        clippedEnd: false,
      } as const,
      expected: "TASK-1 タスク 開始日 2026-08-03 から 期限日 2026-08-06",
    },
    {
      name: "point（開始日のみ）: 期限日なしと明記する",
      startDate: "2026-08-03",
      dueDate: null,
      bar: { type: "point", index: 2, outOfRange: false } as const,
      expected: "TASK-1 タスク 開始日 2026-08-03(期限日なし)",
    },
    {
      name: "point（期限日のみ）: 開始日なしと明記する",
      startDate: null,
      dueDate: "2026-08-06",
      bar: { type: "point", index: 5, outOfRange: false } as const,
      expected: "TASK-1 タスク 期限日 2026-08-06(開始日なし)",
    },
  ])("$name", ({ startDate, dueDate, bar, expected }) => {
    const model = createModel([createTaskRow({ startDate, dueDate, bar })]);
    renderGanttChart(model);

    expect(screen.getByRole("link", { name: expected })).toBeInTheDocument();
  });

  it.each([
    {
      name: "range の clippedEnd で「表示範囲外まで継続」が付く",
      bar: {
        type: "range",
        startIndex: 0,
        endIndex: 9,
        clippedStart: false,
        clippedEnd: true,
      } as const,
    },
    {
      name: "point の outOfRange で「表示範囲外まで継続」が付く",
      bar: { type: "point", index: 9, outOfRange: true } as const,
    },
  ])("$name", ({ bar }) => {
    const model = createModel([
      createTaskRow({ startDate: "2026-08-01", dueDate: "2026-08-10", bar }),
    ]);
    renderGanttChart(model);

    expect(
      screen.getByRole("link", { name: /\(表示範囲外まで継続\)$/ }),
    ).toBeInTheDocument();
  });

  it("clippedStart/clippedEnd がともに false の range バーには接尾辞を付けない", () => {
    const model = createModel([
      createTaskRow({
        startDate: "2026-08-01",
        dueDate: "2026-08-10",
        bar: {
          type: "range",
          startIndex: 0,
          endIndex: 9,
          clippedStart: false,
          clippedEnd: false,
        },
      }),
    ]);
    renderGanttChart(model);

    expect(
      screen.queryByRole("link", { name: /表示範囲外まで継続/ }),
    ).not.toBeInTheDocument();
  });
});

describe("GanttChart の aria-label（Issue 行）", () => {
  it("Issue 行の期間文言はクランプ前の真の期間（startDate/dueDate）から作られ、バーの列 index に依存しない", () => {
    const model = createModel([
      createIssueRow({
        id: "issue_point",
        number: 1,
        title: "点のIssue",
        bar: { type: "point", index: 3, outOfRange: false },
        startDate: "2026-08-04",
        dueDate: "2026-08-04",
      }),
      createIssueRow({
        id: "issue_clipped",
        number: 2,
        title: "クランプされたIssue",
        // バーは表示レンジ末尾(index 4 = 2026-08-05)で切られているが、
        // 文言には真の期限日(2099-12-31)が載ることを検証する
        bar: {
          type: "range",
          startIndex: 1,
          endIndex: 4,
          clippedStart: false,
          clippedEnd: true,
        },
        startDate: "2026-08-02",
        dueDate: "2099-12-31",
      }),
    ]);
    renderGanttChart(model);

    expect(
      screen.getByRole("link", {
        name: "Issue #1 点のIssue 開始日 2026-08-04 から 期限日 2026-08-04",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "Issue #2 クランプされたIssue 開始日 2026-08-02 から 期限日 2099-12-31(表示範囲外まで継続)",
      }),
    ).toBeInTheDocument();
  });
});
