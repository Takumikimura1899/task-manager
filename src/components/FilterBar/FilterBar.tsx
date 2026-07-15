import type { Id } from "../../../convex/_generated/dataModel";
import type { MemberSummary } from "../../hooks/useCurrentMember";
import { EMPTY_FILTER, type FilterState } from "../../lib/filterParams";
import { ISSUE_STATUS_LABELS, type IssueStatus } from "../../lib/issueMeta";
import { type Priority, PRIORITY_OPTIONS } from "../../lib/taskMeta";
import s from "./FilterBar.module.css";

type FilterAttribute = "status" | "priority" | "assignee";

// select の「すべて」（=フィルタ解除）を表す値。IssueStatus/Priority/Id の
// いずれの値とも衝突しない空文字を使う。
const ALL_VALUE = "";

/**
 * 「属性を選ぶ→値を選ぶ」の単一文法によるフィルタ UI（Issue #91）。
 * 属性ごとにネイティブ select を並べ、複数指定は暗黙 AND（呼び出し側の
 * フィルタ適用ロジックで実施。本コンポーネントは選択状態の受け渡しのみ）。
 * どの属性を出すかは attributes で呼び出し側が指定する（Issue一覧とBoardで
 * 語彙が異なるため。Board への適用は本Issueのスコープ外）。
 *
 * members は props で受け取る（内部で useQuery しない）。呼び出し側が
 * 購読済みの一覧（outlet context 等）を渡す想定。
 */
export function FilterBar({
  attributes,
  value,
  onChange,
  members,
}: {
  attributes: readonly FilterAttribute[];
  value: FilterState;
  onChange: (next: FilterState) => void;
  members: readonly MemberSummary[] | undefined;
}) {
  const hasActiveFilter =
    value.status !== null || value.priority !== null || value.assignee !== null;

  return (
    <div className={s.bar}>
      {attributes.includes("status") && (
        <label className={s.field}>
          ステータス
          <select
            className={s.select}
            onChange={(e) =>
              onChange({
                ...value,
                status:
                  e.target.value === ALL_VALUE
                    ? null
                    : (e.target.value as IssueStatus),
              })
            }
            value={value.status ?? ALL_VALUE}
          >
            <option value={ALL_VALUE}>すべて</option>
            {Object.entries(ISSUE_STATUS_LABELS).map(([status, label]) => (
              <option key={status} value={status}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
      {attributes.includes("priority") && (
        <label className={s.field}>
          優先度
          <select
            className={s.select}
            onChange={(e) =>
              onChange({
                ...value,
                priority:
                  e.target.value === ALL_VALUE
                    ? null
                    : (e.target.value as Priority),
              })
            }
            value={value.priority ?? ALL_VALUE}
          >
            <option value={ALL_VALUE}>すべて</option>
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {attributes.includes("assignee") && (
        <label className={s.field}>
          担当者
          <select
            className={s.select}
            onChange={(e) =>
              onChange({
                ...value,
                assignee:
                  e.target.value === ALL_VALUE
                    ? null
                    : (e.target.value as Id<"members">),
              })
            }
            value={value.assignee ?? ALL_VALUE}
          >
            {/* members 未ロード中（undefined）は「すべて」のみ表示する */}
            <option value={ALL_VALUE}>すべて</option>
            {members?.map((m) => (
              <option key={m._id} value={m._id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {hasActiveFilter && (
        <button
          className={s.clear}
          onClick={() => onChange(EMPTY_FILTER)}
          type="button"
        >
          クリア
        </button>
      )}
    </div>
  );
}
