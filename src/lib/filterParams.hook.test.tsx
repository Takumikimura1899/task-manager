import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  MemoryRouter,
  UNSAFE_createMemoryHistory as createMemoryHistory,
  unstable_HistoryRouter as HistoryRouter,
} from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { useIssueListParams } from "./filterParams";

/**
 * useIssueListParams（filter/sort 統合フック、Issue #98）の結合テスト。
 * parse/apply の純粋関数側の仕様は filterParams.test.ts で固定済み。ここでは
 * react-router の useSearchParams と接続した際の振る舞い――特に「1回の
 * setSearchParams で両キー空間を書く」ことで、同一バッチ内の filter/sort
 * 更新が後勝ちで一方を失わないという中核回帰――と、URL からの初期復元・
 * replace 挙動を検証する（React/Router 依存のため純粋関数テストとファイルを分離）。
 */

const assigneeId = "member_1" as Id<"members">;

const createMemoryWrapper =
  (initialEntries: string[] = ["/"]) =>
  ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
  );

describe("useIssueListParams", () => {
  it("filter と sort を1回の setListParams 呼び出しで両方反映する（後勝ちで一方が消えない）", () => {
    const { result } = renderHook(() => useIssueListParams(), {
      wrapper: createMemoryWrapper(),
    });

    act(() => {
      const [, setListParams] = result.current;
      setListParams({
        filter: { status: "done", priority: "urgent", assignee: assigneeId },
        sort: { field: "priority", dir: "desc" },
      });
    });

    const [value] = result.current;
    expect(value).toEqual({
      filter: { status: "done", priority: "urgent", assignee: assigneeId },
      sort: { field: "priority", dir: "desc" },
    });
  });

  it("初期 URL から filter と sort の両方を復元する", () => {
    const { result } = renderHook(() => useIssueListParams(), {
      wrapper: createMemoryWrapper([
        "/?status=open&priority=high&assignee=member_1&sort=priority&dir=desc",
      ]),
    });

    const [value] = result.current;
    expect(value).toEqual({
      filter: { status: "open", priority: "high", assignee: assigneeId },
      sort: { field: "priority", dir: "desc" },
    });
  });

  it("setListParams の呼び出しは履歴を積まず、現在のエントリを置き換える（replace: true）", () => {
    const history = createMemoryHistory({
      initialEntries: ["/", "/issues"],
      initialIndex: 1,
    });
    const { result } = renderHook(() => useIssueListParams(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <HistoryRouter history={history}>{children}</HistoryRouter>
      ),
    });

    act(() => {
      const [, setListParams] = result.current;
      setListParams({
        filter: { status: "open", priority: null, assignee: null },
        sort: null,
      });
    });

    // push であれば index が進むはずだが、replace のため現在位置のまま。
    expect(history.index).toBe(1);
    expect(history.action).toBe("REPLACE");

    // 1つ戻ると更新前の "/issues" ではなく、その前の "/" に着地する
    // （push なら更新前の "/issues" に着地してしまう＝履歴が積まれた証拠）。
    act(() => {
      history.go(-1);
    });
    expect(history.location.pathname).toBe("/");
  });
});
