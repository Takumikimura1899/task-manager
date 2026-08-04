import type { CSSProperties } from "react";
import { Fragment } from "react";
import { Link } from "react-router-dom";
import { formatIssueRef } from "../../lib/formatIssueRef";
import {
  barAriaLabel,
  barGridColumn,
  dayGridColumn,
  formatHeaderDate,
  isDone,
  labelAriaLabel,
  type GanttModel,
  type GanttRow,
} from "../../lib/gantt";
import s from "./GanttChart.module.css";

/**
 * ガントチャート本体（購読なしの純表示。Issue #141）。
 *
 * 単一の CSS Grid（列1=ラベル・列2以降=日）で Issue/Task 行を描く。
 * 全セル（ヘッダー・ラベル・バー）に明示 gridRow を与え auto-placement に
 * 委ねない（週境界・今日線の背面レイヤーと衝突しレイアウトが崩壊するため、
 * headless Chromium での実測で確認済み）。
 */

function barClassName(row: GanttRow): string {
  const classes = [row.kind === "issue" ? s.issueBar : s.taskBar];
  if (row.bar.type === "range") {
    if (row.bar.clippedStart) classes.push(s.clippedStart);
    if (row.bar.clippedEnd) classes.push(s.clippedEnd);
  } else if (row.bar.outOfRange) {
    // range の clippedStart/clippedEnd（角丸解除）と同様、point の
    // outOfRange にも視覚的手掛かりを付ける（aria-label にのみ付与された
    // 「表示範囲外まで継続」を視覚でも示す）。
    classes.push(s.outOfRange);
  }
  if (isDone(row)) classes.push(s.done);
  return classes.join(" ");
}

function labelClassName(row: GanttRow): string {
  return isDone(row) ? `${s.label} ${s.done}` : s.label;
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

      {/* ヘッダー行: 週開始（月曜）に加え、先頭列(index 0)にも必ずラベルを出す
            （短い表示レンジに月曜が含まれずラベルが0個になるのを防ぐ）。
            先頭が週開始の場合は isWeekStart 側の条件と重複しないよう
            index===0 を先に判定する。 */}
      <div className={s.cornerCell} style={{ gridColumn: 1, gridRow: 1 }} />
      {days.map(
        (day, i) =>
          (i === 0 || day.isWeekStart) && (
            <div
              className={s.headerCell}
              key={`header-${day.date}`}
              style={{ gridColumn: dayGridColumn(i), gridRow: 1 }}
            >
              {formatHeaderDate(day.date)}
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
              aria-label={labelAriaLabel(row, ref)}
              className={labelClassName(row)}
              style={{ gridColumn: 1, gridRow }}
              title={`${ref} ${row.title}`}
              to={href}
            >
              <span className={s.ref}>{ref}</span> {row.title}
            </Link>
            <Link
              aria-label={barAriaLabel(row, ref)}
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
