import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import {
  applyFilterParams,
  applySortParams,
  EMPTY_FILTER,
  type FilterState,
  parseFilterParams,
  parseSortParams,
  type SortState,
} from "./filterParams";

/**
 * フィルタ・ソート状態の URL 外在化（parse/apply、Issue #91）の仕様を固定する。
 * - 語彙を閉じる（未知の status/priority は無視して null に倒す）
 * - apply→parse の往復一致（冪等性）
 * - filter と sort は互いに温存し合う（直交するキー）
 * を中心に検証する。
 */

const assigneeId = "member_1" as Id<"members">;

describe("parseFilterParams", () => {
  it("有効な status/priority/assignee を復元する", () => {
    const sp = new URLSearchParams({
      status: "in_progress",
      priority: "high",
      assignee: assigneeId,
    });

    expect(parseFilterParams(sp)).toEqual<FilterState>({
      status: "in_progress",
      priority: "high",
      assignee: assigneeId,
    });
  });

  it("未知の status は null にする（不正値の無視）", () => {
    const sp = new URLSearchParams({ status: "not_a_status" });

    expect(parseFilterParams(sp).status).toBeNull();
  });

  it("未知の priority は null にする（不正値の無視）", () => {
    const sp = new URLSearchParams({ priority: "not_a_priority" });

    expect(parseFilterParams(sp).priority).toBeNull();
  });

  it.each([
    ["status", ""],
    ["priority", ""],
    ["assignee", ""],
  ])("%s が空文字の場合は null にする", (key, value) => {
    const sp = new URLSearchParams({ [key]: value });

    expect(parseFilterParams(sp)[key as keyof FilterState]).toBeNull();
  });

  it("キー自体が欠落している場合は全属性が null になる", () => {
    const sp = new URLSearchParams();

    expect(parseFilterParams(sp)).toEqual<FilterState>(EMPTY_FILTER);
  });
});

describe("applyFilterParams / parseFilterParams の往復（roundtrip）", () => {
  it.each<{ name: string; state: FilterState }>([
    { name: "全属性 null（EMPTY_FILTER）", state: EMPTY_FILTER },
    {
      name: "全属性が非 null",
      state: { status: "done", priority: "urgent", assignee: assigneeId },
    },
    {
      name: "status のみ非 null",
      state: { status: "open", priority: null, assignee: null },
    },
    {
      name: "priority のみ非 null",
      state: { status: null, priority: "low", assignee: null },
    },
    {
      name: "assignee のみ非 null",
      state: { status: null, priority: null, assignee: assigneeId },
    },
  ])("$name の場合 apply→parse で元の状態に一致する", ({ state }) => {
    const applied = applyFilterParams(new URLSearchParams(), state);

    expect(parseFilterParams(applied)).toEqual(state);
  });

  it("null な属性は URL からキーそのものが消える（冪等）", () => {
    const withValues = applyFilterParams(new URLSearchParams(), {
      status: "open",
      priority: "high",
      assignee: assigneeId,
    });

    const cleared = applyFilterParams(withValues, EMPTY_FILTER);

    expect(cleared.has("status")).toBe(false);
    expect(cleared.has("priority")).toBe(false);
    expect(cleared.has("assignee")).toBe(false);
    expect(cleared.toString()).toBe("");
  });
});

describe("applyFilterParams", () => {
  it("既存の sort/dir キーを温存する", () => {
    const sp = new URLSearchParams({ sort: "priority", dir: "asc" });

    const next = applyFilterParams(sp, {
      status: "open",
      priority: null,
      assignee: null,
    });

    expect(next.get("sort")).toBe("priority");
    expect(next.get("dir")).toBe("asc");
    expect(next.get("status")).toBe("open");
  });

  it("元の URLSearchParams を書き換えない（複製して返す）", () => {
    const sp = new URLSearchParams({ status: "open" });

    applyFilterParams(sp, EMPTY_FILTER);

    expect(sp.get("status")).toBe("open");
  });
});

// --- Sort primitives（#93 が消費する基盤） -----------------------------------

describe("parseSortParams / applySortParams の往復（roundtrip）", () => {
  it.each<{ name: string; state: SortState }>([
    { name: "null（未指定）", state: null },
    { name: "priority/asc", state: { field: "priority", dir: "asc" } },
    { name: "updatedAt/desc", state: { field: "updatedAt", dir: "desc" } },
  ])("$name の場合 apply→parse で元の状態に一致する", ({ state }) => {
    const applied = applySortParams(new URLSearchParams(), state);

    expect(parseSortParams(applied)).toEqual(state);
  });
});

describe("parseSortParams", () => {
  it("sort のみ存在し dir が欠落している場合は null にする", () => {
    const sp = new URLSearchParams({ sort: "priority" });

    expect(parseSortParams(sp)).toBeNull();
  });

  it("dir のみ存在し sort が欠落している場合は null にする", () => {
    const sp = new URLSearchParams({ dir: "asc" });

    expect(parseSortParams(sp)).toBeNull();
  });

  it("sort が不正な値の場合は null にする", () => {
    const sp = new URLSearchParams({ sort: "title", dir: "asc" });

    expect(parseSortParams(sp)).toBeNull();
  });

  it("dir が不正な値の場合は null にする", () => {
    const sp = new URLSearchParams({ sort: "priority", dir: "sideways" });

    expect(parseSortParams(sp)).toBeNull();
  });
});

describe("applySortParams", () => {
  it("filter キー（status 等）を温存する", () => {
    const sp = new URLSearchParams({
      status: "open",
      priority: "high",
      assignee: assigneeId,
    });

    const next = applySortParams(sp, { field: "updatedAt", dir: "desc" });

    expect(next.get("status")).toBe("open");
    expect(next.get("priority")).toBe("high");
    expect(next.get("assignee")).toBe(assigneeId);
    expect(next.get("sort")).toBe("updatedAt");
    expect(next.get("dir")).toBe("desc");
  });

  it("null を渡すと sort/dir キー両方を削除し、filter キーは温存する", () => {
    const sp = new URLSearchParams({
      status: "open",
      sort: "priority",
      dir: "asc",
    });

    const next = applySortParams(sp, null);

    expect(next.has("sort")).toBe(false);
    expect(next.has("dir")).toBe(false);
    expect(next.get("status")).toBe("open");
  });
});
