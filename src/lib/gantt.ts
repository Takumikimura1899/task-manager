import { TASK_STATUS_LABELS, type TaskStatus } from "./taskMeta";

/**
 * ガントチャート表示の純粋ロジック（React/DB 非依存・テスト容易）。
 *
 * GanttTaskData / GanttIssueData は convex/tasks.ts の gantt query が返す形の
 * 手動写し（`src/lib/board.ts` の BoardTask と同じ慣習）。gantt query は
 * startDate/dueDate を null に正規化した DTO を返す一方、tasks.getDetail は
 * undefined 透過のため表現が割れる（gantt 専用 DTO としての選択であり、
 * 手動写しゆえに型を揃える必要はない）。
 *
 * 表示写像（グリッド列・軸ラベル・aria 文言）も本ファイルに置く。
 * React / CSS Modules には依存しない。
 */

export type GanttTaskData = {
  _id: string;
  number: number;
  title: string;
  status: TaskStatus;
  startDate: string | null;
  dueDate: string | null;
};

export type GanttIssueData = {
  _id: string;
  number: number;
  title: string;
  tasks: GanttTaskData[];
};

/**
 * 表示レンジ内でのバー配置。range/point とも、表示レンジでクランプされた
 * 列 index を持つ（実日付との対応は GanttModel.days で引く）。
 * - range: clippedStart/clippedEnd は「レンジ外に実データが続いている」印。
 * - point: 表示レンジに完全に収まらない Task は、行を消さず近い端列へ
 *   point + outOfRange=true として寄せる（サイレント失敗の回避）。
 */
export type GanttBar =
  | {
      type: "range";
      startIndex: number;
      endIndex: number;
      clippedStart: boolean;
      clippedEnd: boolean;
    }
  | { type: "point"; index: number; outOfRange: boolean };

export type GanttRow =
  | {
      kind: "issue";
      id: string;
      number: number;
      title: string;
      bar: GanttBar;
      // aria-label 生成専用（GanttChart）: 子 Task から派生した真の期間。
      // GanttBar は表示レンジにクランプ済みの列 index しか持たないため、
      // クランプ前の値をここに残す（Task 行の startDate/dueDate と同じ理由）。
      startDate: string;
      dueDate: string;
    }
  | {
      kind: "task";
      id: string;
      number: number;
      title: string;
      status: TaskStatus;
      bar: GanttBar;
      // aria-label 生成専用（GanttChart）: GanttBar の point は「開始日のみ／
      // 期限日のみ／同日」のいずれで point になったかを区別できないため、
      // 元の値をそのまま残す。
      startDate: string | null;
      dueDate: string | null;
    };

export type GanttModel = {
  days: { date: string; isWeekStart: boolean }[];
  todayIndex: number;
  rows: GanttRow[];
  // 生の Task 範囲が表示レンジからクランプされたかどうか（GanttView のヒント文言用）。
  clamped: { past: boolean; future: boolean };
};

/** 表示レンジは今日から過去何日まで遡るか。 */
const PAST_DAYS = 90;
/** 表示レンジの最大日数（rangeStart からの上限）。 */
const MAX_RANGE_DAYS = 400;
const MS_PER_DAY = 86_400_000;

function toUtcMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function addDaysIso(date: string, days: number): string {
  const d = new Date(toUtcMs(date) + days * MS_PER_DAY);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** rangeStart から date までの日数（負値も許容）。Date.UTC の ms 差を1日=86_400_000 で割る。 */
export function dayIndex(rangeStart: string, date: string): number {
  return Math.round((toUtcMs(date) - toUtcMs(rangeStart)) / MS_PER_DAY);
}

/**
 * 今日の日付（YYYY-MM-DD）をローカルタイムゾーンで返す。
 * 「今日を含む表示レンジ」はユーザーのローカル日付に依存するため UTC ではなく
 * ブラウザのローカル日付（getFullYear/getMonth/getDate）から作る。
 */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Task の [開始位置, 終了位置] を求める。開始位置 = startDate ?? dueDate、
 * 終了位置 = dueDate ?? startDate。両方 null（gantt query の契約上あり得ないが、
 * 純粋関数として防御する）は対象外として除外する。
 */
function positionOf(
  task: GanttTaskData,
): { start: string; end: string } | null {
  const start = task.startDate ?? task.dueDate;
  const end = task.dueDate ?? task.startDate;
  if (start === null || end === null) return null;
  return { start, end };
}

const minIso = (a: string, b: string) => (a < b ? a : b);
const maxIso = (a: string, b: string) => (a > b ? a : b);

/**
 * 生の [start, end] を表示レンジ [rangeStart, rangeEnd] へクランプしてバーを作る。
 * - 完全にレンジ外（end < rangeStart または start > rangeEnd）は、行を消さず
 *   近い端列に point + outOfRange=true として寄せる。
 * - 一部だけレンジ外にはみ出す range は、はみ出した側の index を端に固定し
 *   clippedStart/clippedEnd を立てる。
 * - start === end（point）はそのままレンジ内/外の判定のみ行う。
 */
function buildBar(
  start: string,
  end: string,
  rangeStart: string,
  rangeEnd: string,
  lastIndex: number,
): GanttBar {
  if (start === end) {
    if (start < rangeStart)
      return { type: "point", index: 0, outOfRange: true };
    if (start > rangeEnd)
      return { type: "point", index: lastIndex, outOfRange: true };
    return {
      type: "point",
      index: dayIndex(rangeStart, start),
      outOfRange: false,
    };
  }

  if (end < rangeStart) return { type: "point", index: 0, outOfRange: true };
  if (start > rangeEnd)
    return { type: "point", index: lastIndex, outOfRange: true };

  const clippedStart = start < rangeStart;
  const clippedEnd = end > rangeEnd;
  return {
    type: "range",
    startIndex: clippedStart ? 0 : dayIndex(rangeStart, start),
    endIndex: clippedEnd ? lastIndex : dayIndex(rangeStart, end),
    clippedStart,
    clippedEnd,
  };
}

/**
 * ガントチャートの表示モデルを組み立てる。
 * - 行順: Issue は派生開始位置昇順・同値は number 昇順。直後に子 Task を
 *   開始位置昇順・同値は number 昇順で並べる。
 * - 表示レンジ: `rangeStart = max(生min, today − PAST_DAYS)`、
 *   `rangeEnd = min(生max, rangeStart + MAX_RANGE_DAYS − 1)`。生 min/max は
 *   today を含めて算出するため、上記の rangeStart は必ず today 以下、
 *   rangeEnd は必ず today 以上になり、レンジは常に today を含む
 *   （rangeStart ≥ today − PAST_DAYS なので rangeStart + MAX_RANGE_DAYS − 1 は
 *   today を追い越す）。
 */
export function buildGanttModel(
  issues: readonly GanttIssueData[],
  today: string,
): GanttModel {
  const prepared = issues
    .map((issue) => {
      const tasks = issue.tasks
        .map((t) => {
          const pos = positionOf(t);
          return pos === null ? null : { ...t, ...pos };
        })
        .filter(
          (t): t is GanttTaskData & { start: string; end: string } =>
            t !== null,
        );
      return { issue, tasks };
    })
    .filter((entry) => entry.tasks.length > 0)
    .map((entry) => {
      let start = entry.tasks[0].start;
      let end = entry.tasks[0].end;
      for (const t of entry.tasks) {
        start = minIso(start, t.start);
        end = maxIso(end, t.end);
      }
      return { ...entry, start, end };
    });

  let rawMin = today;
  let rawMax = today;
  for (const entry of prepared) {
    rawMin = minIso(rawMin, entry.start);
    rawMax = maxIso(rawMax, entry.end);
  }

  const rangeStart = maxIso(rawMin, addDaysIso(today, -PAST_DAYS));
  const rangeEnd = minIso(rawMax, addDaysIso(rangeStart, MAX_RANGE_DAYS - 1));
  const clamped = { past: rawMin < rangeStart, future: rawMax > rangeEnd };

  const lastIndex = dayIndex(rangeStart, rangeEnd);
  const days = Array.from({ length: lastIndex + 1 }, (_, i) => {
    const date = addDaysIso(rangeStart, i);
    return {
      date,
      isWeekStart: new Date(toUtcMs(date)).getUTCDay() === 1,
    };
  });

  const sortedEntries = prepared.toSorted((a, b) =>
    a.start === b.start
      ? a.issue.number - b.issue.number
      : a.start < b.start
        ? -1
        : 1,
  );

  const rows: GanttRow[] = [];
  for (const entry of sortedEntries) {
    rows.push({
      kind: "issue",
      id: entry.issue._id,
      number: entry.issue.number,
      title: entry.issue.title,
      bar: buildBar(entry.start, entry.end, rangeStart, rangeEnd, lastIndex),
      startDate: entry.start,
      dueDate: entry.end,
    });

    const sortedTasks = entry.tasks.toSorted((a, b) =>
      a.start === b.start ? a.number - b.number : a.start < b.start ? -1 : 1,
    );
    for (const t of sortedTasks) {
      rows.push({
        kind: "task",
        id: t._id,
        number: t.number,
        title: t.title,
        status: t.status,
        bar: buildBar(t.start, t.end, rangeStart, rangeEnd, lastIndex),
        startDate: t.startDate,
        dueDate: t.dueDate,
      });
    }
  }

  return {
    days,
    todayIndex: dayIndex(rangeStart, today),
    rows,
    clamped,
  };
}

/*
 * 表示写像（グリッド列・軸ラベル・aria 文言）。
 * GanttChart.tsx から移設（Issue #149）。
 */

const CONTINUATION_SUFFIX = "(表示範囲外まで継続)";
// 状態語はラベル定数の正(taskMeta)から組み立てる(UI文言・配置規約 §4)
const DONE_SUFFIX = `(${TASK_STATUS_LABELS.done})`;

/** 日 index → CSS grid 列番号（列1=ラベル。変換はこの1箇所に集約する）。 */
export function dayGridColumn(index: number): number {
  return index + 2;
}

/** ヘッダー軸ラベル「M/D」を ISO 日付（YYYY-MM-DD）から導出する。 */
export function formatHeaderDate(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

export function barGridColumn(bar: GanttBar): string {
  return bar.type === "range"
    ? `${dayGridColumn(bar.startIndex)} / ${dayGridColumn(bar.endIndex) + 1}`
    : `${dayGridColumn(bar.index)}`;
}

function isBarClipped(bar: GanttBar): boolean {
  return bar.type === "range"
    ? bar.clippedStart || bar.clippedEnd
    : bar.outOfRange;
}

/**
 * Task 行の期間文言。GanttBar は表示レンジにクランプ済みの列 index しか
 * 持たないため（「開始日のみ」「期限日のみ」「同日」のいずれで point に
 * なったかを区別できない）、元の startDate/dueDate（GanttRow.task が保持）を
 * そのまま使う。
 */
function formatTaskPeriod(
  startDate: string | null,
  dueDate: string | null,
): string {
  if (startDate !== null && dueDate !== null) {
    return `開始日 ${startDate} から 期限日 ${dueDate}`;
  }
  if (startDate !== null) return `開始日 ${startDate}(期限日なし)`;
  // gantt query の契約上、startDate/dueDate の少なくとも一方は必ず設定される。
  return `期限日 ${dueDate}(開始日なし)`;
}

export function isDone(row: GanttRow): boolean {
  return row.kind === "task" && row.status === "done";
}

export function barAriaLabel(row: GanttRow, ref: string): string {
  // Issue 行も Task 行もクランプ前の真の期間（GanttRow.startDate/dueDate）から
  // 整形する。バーの列 index から日付を引くと、レンジ外の期間がクランプ後の
  // 日付として読み上げられてしまう（実機検証で検出）。
  // done は視覚上 opacity でしか表現されないため、状態語をここで補う。
  const period = formatTaskPeriod(row.startDate, row.dueDate);
  const clip = isBarClipped(row.bar) ? CONTINUATION_SUFFIX : "";
  const done = isDone(row) ? DONE_SUFFIX : "";
  return `${ref} ${row.title} ${period}${clip}${done}`;
}

/** ラベル側 Link の aria-label。done のときのみ状態語を補い、他は undefined（title の読み上げに委ねる）。 */
export function labelAriaLabel(row: GanttRow, ref: string): string | undefined {
  return isDone(row) ? `${ref} ${row.title}${DONE_SUFFIX}` : undefined;
}
