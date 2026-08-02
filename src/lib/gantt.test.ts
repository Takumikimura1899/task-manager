import { describe, expect, it } from "vitest";
import {
  buildGanttModel,
  dayIndex,
  type GanttIssueData,
  type GanttTaskData,
  todayIso,
} from "./gantt";

/**
 * ガントチャート表示の純粋ロジック（Issue #141 PR2）を検証する。
 * DB/React 非依存の関数のみを対象にした単体テスト。
 * convex/tasks.ts の gantt query の振る舞い（DB との結合）は
 * convex/tasks.test.ts の describe("tasks.gantt") 側で検証する。
 */

const createTask = (overrides: Partial<GanttTaskData> = {}): GanttTaskData => ({
  _id: "task_1",
  number: 1,
  title: "タスク",
  status: "todo",
  startDate: null,
  dueDate: null,
  ...overrides,
});

const createIssue = (
  overrides: Partial<GanttIssueData> = {},
): GanttIssueData => ({
  _id: "issue_1",
  number: 1,
  title: "課題",
  tasks: [createTask()],
  ...overrides,
});

/** フィクスチャ用の日付加算（テスト対象の内部実装 addDaysIso とは独立の素朴な実装）。 */
const addDays = (iso: string, days: number): string => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
};

describe("dayIndex", () => {
  it("月をまたぐ差分を正しく計算する", () => {
    expect(dayIndex("2026-01-25", "2026-02-03")).toBe(9);
  });

  it("年をまたぐ差分を正しく計算する", () => {
    expect(dayIndex("2025-12-28", "2026-01-03")).toBe(6);
  });

  it("うるう日をまたぐ差分を正しく計算する", () => {
    expect(dayIndex("2024-02-28", "2024-03-01")).toBe(2);
  });
});

describe("todayIso", () => {
  it("指定した Date のローカル日付を YYYY-MM-DD（ゼロ埋め）で返す", () => {
    expect(todayIso(new Date(2026, 7, 3))).toBe("2026-08-03");
    expect(todayIso(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("buildGanttModel", () => {
  it("Issue が1件も無い場合、today だけの1日レンジを返す", () => {
    const model = buildGanttModel([], "2026-08-03");

    expect(model.days).toHaveLength(1);
    expect(model.days[0]).toMatchObject({ date: "2026-08-03", isToday: true });
    expect(model.todayIndex).toBe(0);
    expect(model.rows).toEqual([]);
    expect(model.clamped).toEqual({ past: false, future: false });
  });

  it("全 Task が過去のみでも today がレンジ末尾（rawMax）を押し広げる", () => {
    const issue = createIssue({
      tasks: [createTask({ startDate: "2024-01-01", dueDate: "2024-01-05" })],
    });

    const model = buildGanttModel([issue], "2024-01-10");

    const lastDay = model.days.at(-1);
    expect(lastDay).toMatchObject({ date: "2024-01-10", isToday: true });
    expect(model.todayIndex).toBe(model.days.length - 1);
  });

  it("全 Task が未来のみでも today がレンジ先頭（rawMin）を押し広げる", () => {
    const issue = createIssue({
      tasks: [createTask({ startDate: "2024-01-10", dueDate: "2024-01-15" })],
    });

    const model = buildGanttModel([issue], "2024-01-01");

    expect(model.days[0]).toMatchObject({ date: "2024-01-01", isToday: true });
    expect(model.todayIndex).toBe(0);
  });

  it("dueDate のみの単一 Task は開始==終了となり point バーになる（Issue バーも同じ点に一致）", () => {
    const issue = createIssue({
      number: 1,
      tasks: [createTask({ _id: "task_a", number: 1, dueDate: "2024-01-05" })],
    });

    const model = buildGanttModel([issue], "2024-01-01");

    // rangeStart は today（2024-01-01）に一致するため index は日数差そのもの
    const taskRow = model.rows.find((r) => r.id === "task_a");
    const issueRow = model.rows.find((r) => r.id === "issue_1");
    expect(taskRow?.bar).toEqual({
      type: "point",
      index: 4,
      outOfRange: false,
    });
    expect(issueRow?.bar).toEqual({
      type: "point",
      index: 4,
      outOfRange: false,
    });
  });

  it("dueDate のみの Task 群（別日）から Issue バーを min/max で派生し range になる", () => {
    const issue = createIssue({
      number: 1,
      tasks: [
        createTask({ _id: "task_a", number: 1, dueDate: "2024-01-03" }),
        createTask({ _id: "task_b", number: 2, dueDate: "2024-01-07" }),
      ],
    });

    const model = buildGanttModel([issue], "2024-01-01");

    const taskA = model.rows.find((r) => r.id === "task_a");
    const taskB = model.rows.find((r) => r.id === "task_b");
    const issueRow = model.rows.find((r) => r.id === "issue_1");
    expect(taskA?.bar).toEqual({ type: "point", index: 2, outOfRange: false });
    expect(taskB?.bar).toEqual({ type: "point", index: 6, outOfRange: false });
    expect(issueRow?.bar).toEqual({
      type: "range",
      startIndex: 2,
      endIndex: 6,
      clippedStart: false,
      clippedEnd: false,
    });
  });

  it("Issue は派生開始位置の昇順で並び、各 Issue の直後に子 Task が続く", () => {
    const issueEarly = createIssue({
      _id: "issue_early",
      number: 2, // number は大きいが開始位置が早い
      tasks: [
        createTask({ _id: "task_early", number: 1, dueDate: "2024-01-03" }),
      ],
    });
    const issueLate = createIssue({
      _id: "issue_late",
      number: 1,
      tasks: [
        createTask({ _id: "task_late", number: 1, dueDate: "2024-01-10" }),
      ],
    });

    const model = buildGanttModel([issueLate, issueEarly], "2024-01-01");

    expect(model.rows.map((r) => ({ kind: r.kind, id: r.id }))).toEqual([
      { kind: "issue", id: "issue_early" },
      { kind: "task", id: "task_early" },
      { kind: "issue", id: "issue_late" },
      { kind: "task", id: "task_late" },
    ]);
  });

  it("Issue の派生開始位置が同値なら number 昇順で並ぶ", () => {
    const issueHighNumber = createIssue({
      _id: "issue_high",
      number: 9,
      tasks: [createTask({ dueDate: "2024-01-05" })],
    });
    const issueLowNumber = createIssue({
      _id: "issue_low",
      number: 4,
      tasks: [createTask({ dueDate: "2024-01-05" })],
    });

    const model = buildGanttModel(
      [issueHighNumber, issueLowNumber],
      "2024-01-01",
    );

    expect(
      model.rows.filter((r) => r.kind === "issue").map((r) => r.id),
    ).toEqual(["issue_low", "issue_high"]);
  });

  it("子 Task の開始位置が同値なら number 昇順で並ぶ", () => {
    const issue = createIssue({
      tasks: [
        createTask({ _id: "task_high", number: 5, dueDate: "2024-01-02" }),
        createTask({ _id: "task_low", number: 2, dueDate: "2024-01-02" }),
      ],
    });

    const model = buildGanttModel([issue], "2024-01-01");

    expect(
      model.rows.filter((r) => r.kind === "task").map((r) => r.id),
    ).toEqual(["task_low", "task_high"]);
  });

  it("isWeekStart は月曜のみ true、isToday は today の日のみ true になる", () => {
    // 2024-01-01 は月曜日（既知の起点）。14日レンジで月曜が2回出現する。
    const issue = createIssue({
      tasks: [createTask({ startDate: "2024-01-01", dueDate: "2024-01-14" })],
    });

    const model = buildGanttModel([issue], "2024-01-01");

    expect(model.days.filter((d) => d.isWeekStart).map((d) => d.date)).toEqual([
      "2024-01-01",
      "2024-01-08",
    ]);
    expect(model.days.filter((d) => d.isToday).map((d) => d.date)).toEqual([
      "2024-01-01",
    ]);
  });

  describe("クランプ（表示レンジの上限・下限）", () => {
    it("未来方向: 遠い未来の Task があっても days.length は400日以内に収まり、レンジ外 Task は端列に point+outOfRange で残る", () => {
      const today = "2026-08-03";
      const issue = createIssue({
        tasks: [
          // レンジ内に完全に収まる range バー（clippedEnd は立たない）
          createTask({
            _id: "task_normal",
            number: 1,
            startDate: today,
            dueDate: addDays(today, 10),
          }),
          // 400日レンジを大きく超える point（表示対象からは消えず端に寄る）
          createTask({
            _id: "task_far",
            number: 2,
            dueDate: "2099-12-31",
          }),
          // レンジ内で開始し、末尾がレンジ外まではみ出す range（clippedEnd が立つ）
          createTask({
            _id: "task_clipped_end",
            number: 3,
            startDate: addDays(today, 390),
            dueDate: addDays(today, 410),
          }),
        ],
      });

      const model = buildGanttModel([issue], today);
      const lastIndex = model.days.length - 1;

      expect(model.days.length).toBeLessThanOrEqual(400);
      expect(model.clamped).toEqual({ past: false, future: true });

      const far = model.rows.find((r) => r.id === "task_far");
      expect(far?.bar).toEqual({
        type: "point",
        index: lastIndex,
        outOfRange: true,
      });

      const normal = model.rows.find((r) => r.id === "task_normal");
      expect(normal?.bar).toEqual({
        type: "range",
        startIndex: 0,
        endIndex: 10,
        clippedStart: false,
        clippedEnd: false,
      });

      const clippedEnd = model.rows.find((r) => r.id === "task_clipped_end");
      expect(clippedEnd?.bar).toEqual({
        type: "range",
        startIndex: 390,
        endIndex: lastIndex,
        clippedStart: false,
        clippedEnd: true,
      });
    });

    it("過去方向: 90日超過去の Task があると rangeStart が today-90 にクランプされ clamped.past が true になる", () => {
      const today = "2026-08-03";
      const issue = createIssue({
        tasks: [
          createTask({
            _id: "task_old",
            startDate: addDays(today, -100),
            dueDate: addDays(today, -10),
          }),
        ],
      });

      const model = buildGanttModel([issue], today);

      expect(model.rangeStart).toBe(addDays(today, -90));
      expect(model.clamped).toEqual({ past: true, future: false });

      const old = model.rows.find((r) => r.id === "task_old");
      // 開始(today-100)はレンジ外に切り落とされ clippedStart、
      // 終了(today-10)はレンジ内（rangeEnd は today に一致）なので clippedEnd は立たない
      expect(old?.bar).toEqual({
        type: "range",
        startIndex: 0,
        endIndex: 80,
        clippedStart: true,
        clippedEnd: false,
      });
    });
  });
});
