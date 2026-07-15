import type { SortState } from "../../lib/filterParams";
import s from "./SortBar.module.css";

type SortOption = {
  value: string;
  label: string;
  state: SortState;
};

// select の「並び替えなし」（=ソート解除）を表す値。他の選択肢の value
// （`${field}-${dir}`）とは衝突しない空文字を使う（FilterBar の ALL_VALUE
// と同じ作法）。
const NONE_VALUE = "";

/**
 * SortState（field/dir の直積）と1 select の選択肢を相互変換するテーブル。
 * 「並び替えなし（既定順）/ 優先度 高い順 / 優先度 低い順 / 更新が新しい順 /
 * 更新が古い順」の5択に閉じ、呼び出し側は SortState のみを扱えばよい
 * （Issue #93）。
 */
const SORT_OPTIONS: readonly SortOption[] = [
  { value: NONE_VALUE, label: "並び替えなし（既定順）", state: null },
  {
    value: "priority-desc",
    label: "優先度 高い順",
    state: { field: "priority", dir: "desc" },
  },
  {
    value: "priority-asc",
    label: "優先度 低い順",
    state: { field: "priority", dir: "asc" },
  },
  {
    value: "updatedAt-desc",
    label: "更新が新しい順",
    state: { field: "updatedAt", dir: "desc" },
  },
  {
    value: "updatedAt-asc",
    label: "更新が古い順",
    state: { field: "updatedAt", dir: "asc" },
  },
];

function toOptionValue(state: SortState): string {
  return state === null ? NONE_VALUE : `${state.field}-${state.dir}`;
}

/**
 * Issue一覧の並び替えセレクト（Issue #93）。FilterBar とは独立した別コンポー
 * ネントとして分離する（FilterBar は Issue #92 と並行利用中のため無改変で
 * 温存し、本コンポーネントはそれに馴染む見た目のネイティブ select にする）。
 *
 * filter（何を出すか）とは直交する display option（どう見せるか）のため、
 * FilterState とは混ぜず、独立した SortState を扱う（URL外在化は
 * `useSortParams` 側の責務、詳細は docs/詳細画面設計.md §8 参照）。
 */
export function SortBar({
  value,
  onChange,
}: {
  value: SortState;
  onChange: (next: SortState) => void;
}) {
  return (
    <label className={s.field}>
      並び替え
      <select
        className={s.select}
        onChange={(e) => {
          const option = SORT_OPTIONS.find((o) => o.value === e.target.value);
          onChange(option?.state ?? null);
        }}
        value={toOptionValue(value)}
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
