import type { CSSProperties } from "react";
import { Fragment } from "react";
import { Link } from "react-router-dom";
import { formatIssueRef } from "../../lib/formatIssueRef";
import type { GanttBar, GanttModel, GanttRow } from "../../lib/gantt";
import { TASK_STATUS_LABELS } from "../../lib/taskMeta";
import s from "./GanttChart.module.css";

/**
 * ガントチャート本体（購読なしの純表示。Issue #141）。
 *
 * 単一の CSS Grid（列1=ラベル・列2以降=日）で Issue/Task 行を描く。
 * 全セル（ヘッダー・ラベル・バー）に明示 gridRow を与え auto-placement に
 * 委ねない（週境界・今日線の背面レイヤーと衝突しレイアウトが崩壊するため、
 * headless Chromium での実測で確認済み）。
 */

const CONTINUATION_SUFFIX = "(表示範囲外まで継続)";
// 状態語はラベル定数の正(taskMeta)から組み立てる(UI文言・配置規約 §4)
const DONE_SUFFIX = `(${TASK_STATUS_LABELS.done})`;

/** 日 index → CSS grid 列番号（列1=ラベル。変換はこの1箇所に集約する）。 */
function dayGridColumn(index: number): number {
  return index + 2;
}

function barGridColumn(bar: GanttBar): string {
  return bar.type === "range"
    ? `${dayGridColumn(bar.startIndex)} / ${dayGridColumn(bar.endIndex) + 1}`
    : `${dayGridColumn(bar.index)}`;
}

function isBarClipped(bar: GanttBar): boolean {
  return bar.type === "range"
    ? bar.clippedStart || bar.clippedEnd
    : bar.outOfRange;
}

function barClassName(row: GanttRow): string {
  const classes = [row.kind === "issue" ? s.issueBar : s.taskBar];
  if (row.bar.type === "range") {
    if (row.bar.clippedStart) classes.push(s.clippedStart);
    if (row.bar.clippedEnd) classes.push(s.clippedEnd);
  }
  if (isDone(row)) classes.push(s.done);
  return classes.join(" ");
}

function labelClassName(row: GanttRow): string {
  return isDone(row) ? `${s.label} ${s.done}` : s.label;
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

function isDone(row: GanttRow): boolean {
  return row.kind === "task" && row.status === "done";
}

function ariaLabelFor(row: GanttRow, ref: string): string {
  // Issue 行も Task 行もクランプ前の真の期間（GanttRow.startDate/dueDate）から
  // 整形する。バーの列 index から日付を引くと、レンジ外の期間がクランプ後の
  // 日付として読み上げられてしまう（実機検証で検出）。
  // done は視覚上 opacity でしか表現されないため、状態語をここで補う。
  const period = formatTaskPeriod(row.startDate, row.dueDate);
  const clip = isBarClipped(row.bar) ? CONTINUATION_SUFFIX : "";
  const done = isDone(row) ? DONE_SUFFIX : "";
  return `${ref} ${row.title} ${period}${clip}${done}`;
}

export function GanttChart({
  model,
  projectKey,
}: {
  model: GanttModel;
  projectKey: string;
}) {
  const { days, rows, todayIndex } = model;

  return (
    <div
      className={s.grid}
      style={
        {
          "--gantt-days": days.length,
          gridTemplateRows: `repeat(${rows.length + 1}, auto)`,
        } as CSSProperties
      }
    >
      {/* 背面レイヤー(週境界・今日線): DOM 先頭に置くことで z-index なしに
            後続のセルより背面へ回る（非positioned要素はツリー順で描画される）。 */}
      {days.map(
        (day, i) =>
          day.isWeekStart && (
            <div
              className={s.weekLine}
              key={`week-${day.date}`}
              style={{ gridColumn: dayGridColumn(i) }}
            />
          ),
      )}
      <div
        className={s.todayLine}
        style={{ gridColumn: dayGridColumn(todayIndex) }}
      />

      {/* ヘッダー行 */}
      <div className={s.cornerCell} style={{ gridColumn: 1, gridRow: 1 }} />
      {days.map(
        (day, i) =>
          day.isWeekStart && (
            <div
              className={s.headerCell}
              key={`header-${day.date}`}
              style={{ gridColumn: dayGridColumn(i), gridRow: 1 }}
            >
              {Number(day.date.slice(5, 7))}/{day.dayOfMonth}
            </div>
          ),
      )}

      {/* データ行 */}
      {rows.map((row, i) => {
        const gridRow = i + 2;
        const href =
          row.kind === "issue"
            ? `/${projectKey}/issues/${row.number}`
            : `/${projectKey}/tasks/${row.number}`;
        const ref =
          row.kind === "issue"
            ? formatIssueRef(row.number)
            : `${projectKey}-${row.number}`;

        return (
          <Fragment key={row.id}>
            <Link
              aria-label={
                isDone(row) ? `${ref} ${row.title}${DONE_SUFFIX}` : undefined
              }
              className={labelClassName(row)}
              style={{ gridColumn: 1, gridRow }}
              title={`${ref} ${row.title}`}
              to={href}
            >
              <span className={s.ref}>{ref}</span> {row.title}
            </Link>
            <Link
              aria-label={ariaLabelFor(row, ref)}
              className={barClassName(row)}
              style={{ gridColumn: barGridColumn(row.bar), gridRow }}
              to={href}
            />
          </Fragment>
        );
      })}
    </div>
  );
}
