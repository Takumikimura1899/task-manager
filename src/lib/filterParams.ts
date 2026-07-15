import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { Id } from "../../convex/_generated/dataModel";
import { ISSUE_STATUS_LABELS, type IssueStatus } from "./issueMeta";
import { type Priority, PRIORITY_OPTIONS } from "./taskMeta";

/**
 * フィルタ状態の URL 外在化（Linear の「状態の外在化＝URL＝共有可能」原則）。
 * parse/apply は純粋関数として分離し単体テスト可能にする（詳細は
 * docs/詳細画面設計.md の該当節参照）。
 *
 * - 語彙を閉じる: status/priority は既知集合以外を無視して null に倒す
 *   （不正値のクラッシュ・予期しない表示を防ぐ）。
 * - 冪等性: apply は null を delete として扱うため、
 *   parse(apply(sp, state)) は state と一致する（往復一致）。
 * - 他キー（sort/dir 等）は温存する。filter と sort は互いに干渉しない
 *   別キーとして直交させる。
 */

export type FilterState = {
  status: IssueStatus | null;
  priority: Priority | null;
  assignee: Id<"members"> | null;
};

export const EMPTY_FILTER: FilterState = {
  status: null,
  priority: null,
  assignee: null,
};

const PRIORITY_VALUES: readonly Priority[] = PRIORITY_OPTIONS.map(
  (o) => o.value,
);

function setOrDelete(
  sp: URLSearchParams,
  key: string,
  value: string | null,
): void {
  if (value === null) {
    sp.delete(key);
  } else {
    sp.set(key, value);
  }
}

/** URL search params から FilterState を厳密パースする（不正値は無視して null）。 */
export function parseFilterParams(sp: URLSearchParams): FilterState {
  const statusRaw = sp.get("status");
  const status =
    statusRaw !== null && Object.hasOwn(ISSUE_STATUS_LABELS, statusRaw)
      ? (statusRaw as IssueStatus)
      : null;

  const priorityRaw = sp.get("priority");
  const priority =
    priorityRaw !== null && PRIORITY_VALUES.includes(priorityRaw as Priority)
      ? (priorityRaw as Priority)
      : null;

  // assignee の実在確認は View 側で issues/members と突合する。stale な id
  // が渡ってきても該当なし＝0件になるだけで安全なため、ここでは形式チェック
  // のみ（非空文字であれば Id<"members"> とみなす）。
  const assigneeRaw = sp.get("assignee");
  const assignee =
    assigneeRaw !== null && assigneeRaw !== ""
      ? (assigneeRaw as Id<"members">)
      : null;

  return { status, priority, assignee };
}

/**
 * FilterState を URL search params へ反映する。複製した上で
 * status/priority/assignee キーのみ set し（null は delete）、
 * 他キー（sort/dir 等）は温存する。
 */
export function applyFilterParams(
  sp: URLSearchParams,
  state: FilterState,
): URLSearchParams {
  const next = new URLSearchParams(sp);
  setOrDelete(next, "status", state.status);
  setOrDelete(next, "priority", state.priority);
  setOrDelete(next, "assignee", state.assignee);
  return next;
}

/** IssuesView 等の呼び出し側から使う、URL 外在化済みのフィルタ状態フック。 */
export function useFilterParams(): readonly [
  FilterState,
  (next: FilterState) => void,
] {
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = useMemo(() => parseFilterParams(searchParams), [searchParams]);

  const setFilter = (next: FilterState) => {
    setSearchParams((prev) => applyFilterParams(prev, next), {
      replace: true,
    });
  };

  return [filter, setFilter] as const;
}

// --- Sort（#93 が消費する基盤。本 Issue では primitives のみ用意） ---------

export type SortField = "priority" | "updatedAt";
export type SortDir = "asc" | "desc";
export type SortState = { field: SortField; dir: SortDir } | null;

const SORT_FIELDS: readonly SortField[] = ["priority", "updatedAt"];
const SORT_DIRS: readonly SortDir[] = ["asc", "desc"];

/** URL search params から SortState を厳密パースする（sort/dir どちらか不正・欠落なら null）。 */
export function parseSortParams(sp: URLSearchParams): SortState {
  const fieldRaw = sp.get("sort");
  const dirRaw = sp.get("dir");
  if (fieldRaw === null || dirRaw === null) return null;
  if (!SORT_FIELDS.includes(fieldRaw as SortField)) return null;
  if (!SORT_DIRS.includes(dirRaw as SortDir)) return null;
  return { field: fieldRaw as SortField, dir: dirRaw as SortDir };
}

/**
 * SortState を URL search params へ反映する。null 時は sort/dir 両方を
 * delete し、filter キー（status/priority/assignee）は温存する。
 */
export function applySortParams(
  sp: URLSearchParams,
  state: SortState,
): URLSearchParams {
  const next = new URLSearchParams(sp);
  if (state === null) {
    next.delete("sort");
    next.delete("dir");
  } else {
    next.set("sort", state.field);
    next.set("dir", state.dir);
  }
  return next;
}

/** URL 外在化済みのソート状態フック（#93 の Issue 一覧ソート UI が使用）。 */
export function useSortParams(): readonly [
  SortState,
  (next: SortState) => void,
] {
  const [searchParams, setSearchParams] = useSearchParams();
  const sort = useMemo(() => parseSortParams(searchParams), [searchParams]);

  const setSort = (next: SortState) => {
    setSearchParams((prev) => applySortParams(prev, next), {
      replace: true,
    });
  };

  return [sort, setSort] as const;
}
