import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MemberSummary } from "../../hooks/useCurrentMember";
import { EMPTY_FILTER, type FilterState } from "../../lib/filterParams";
import { FilterBar } from "./FilterBar";

/**
 * 「属性を選ぶ→値を選ぶ」の単一文法によるフィルタ UI（Issue #91）の振る舞いを検証する。
 * attributes による表示の出し分け、onChange に渡る FilterState、members
 * 未ロード時の assignee select、クリアボタンの表示条件と挙動を確認する。
 * 値の適用ロジック（AND フィルタ）自体は IssuesView 側の責務なので対象外。
 */

type FilterBarProps = Parameters<typeof FilterBar>[0];

const createOnChange = () => vi.fn<(next: FilterState) => void>();

const members: readonly MemberSummary[] = [
  { _id: "member_1" as Id<"members">, name: "Alice" },
  { _id: "member_2" as Id<"members">, name: "Bob" },
];

const createProps = (
  overrides: Partial<FilterBarProps> = {},
): FilterBarProps => ({
  attributes: ["status", "priority", "assignee"],
  value: EMPTY_FILTER,
  onChange: createOnChange(),
  members,
  ...overrides,
});

describe("FilterBar の attributes による表示制御", () => {
  it("attributes に含まれる属性の select のみを表示する", () => {
    render(<FilterBar {...createProps({ attributes: ["status"] })} />);

    expect(screen.getByLabelText("ステータス")).toBeInTheDocument();
    expect(screen.queryByLabelText("優先度")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("担当者")).not.toBeInTheDocument();
  });

  it("attributes が空なら select を1つも表示しない", () => {
    render(<FilterBar {...createProps({ attributes: [] })} />);

    expect(screen.queryByLabelText("ステータス")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("優先度")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("担当者")).not.toBeInTheDocument();
  });

  it("attributes に3属性すべて含めればすべての select を表示する", () => {
    render(<FilterBar {...createProps()} />);

    expect(screen.getByLabelText("ステータス")).toBeInTheDocument();
    expect(screen.getByLabelText("優先度")).toBeInTheDocument();
    expect(screen.getByLabelText("担当者")).toBeInTheDocument();
  });
});

describe("FilterBar の値選択と onChange", () => {
  it("ステータスを選択すると、他の属性を保ったまま status を反映した FilterState で onChange を呼ぶ", async () => {
    const user = userEvent.setup();
    const onChange = createOnChange();
    const value: FilterState = {
      status: null,
      priority: "high",
      assignee: "member_1" as Id<"members">,
    };
    render(<FilterBar {...createProps({ onChange, value })} />);

    await user.selectOptions(screen.getByLabelText("ステータス"), "done");

    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      status: "done",
      priority: "high",
      assignee: "member_1",
    });
  });

  it("優先度を選択すると、他の属性を保ったまま priority を反映した FilterState で onChange を呼ぶ", async () => {
    const user = userEvent.setup();
    const onChange = createOnChange();
    const value: FilterState = {
      status: "open",
      priority: null,
      assignee: null,
    };
    render(<FilterBar {...createProps({ onChange, value })} />);

    await user.selectOptions(screen.getByLabelText("優先度"), "urgent");

    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      status: "open",
      priority: "urgent",
      assignee: null,
    });
  });

  it("担当者を選択すると、他の属性を保ったまま assignee を反映した FilterState で onChange を呼ぶ", async () => {
    const user = userEvent.setup();
    const onChange = createOnChange();
    const value: FilterState = {
      status: "open",
      priority: "high",
      assignee: null,
    };
    render(<FilterBar {...createProps({ onChange, value })} />);

    await user.selectOptions(screen.getByLabelText("担当者"), "Bob");

    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      status: "open",
      priority: "high",
      assignee: "member_2",
    });
  });

  it.each([
    { label: "ステータス", field: "status" },
    { label: "優先度", field: "priority" },
    { label: "担当者", field: "assignee" },
  ] as const)(
    "$label で「すべて」を選択すると該当属性のみ null にする",
    async ({ label, field }) => {
      const user = userEvent.setup();
      const onChange = createOnChange();
      const value: FilterState = {
        status: "open",
        priority: "high",
        assignee: "member_1" as Id<"members">,
      };
      render(<FilterBar {...createProps({ onChange, value })} />);

      await user.selectOptions(screen.getByLabelText(label), "すべて");

      expect(onChange).toHaveBeenCalledExactlyOnceWith({
        ...value,
        [field]: null,
      });
    },
  );
});

describe("FilterBar の members 未ロード時の assignee select", () => {
  it("members が undefined の場合は「すべて」以外の選択肢を表示しない", () => {
    render(<FilterBar {...createProps({ members: undefined })} />);

    const select = screen.getByLabelText("担当者");
    expect(within(select).getAllByRole("option")).toHaveLength(1);
    expect(
      within(select).getByRole("option", { name: "すべて" }),
    ).toBeInTheDocument();
  });

  it("members がロード済みの場合は各メンバーを選択肢として表示する", () => {
    render(<FilterBar {...createProps()} />);

    const select = screen.getByLabelText("担当者");
    expect(within(select).getAllByRole("option")).toHaveLength(3); // すべて + Alice + Bob
    expect(
      within(select).getByRole("option", { name: "Alice" }),
    ).toBeInTheDocument();
    expect(
      within(select).getByRole("option", { name: "Bob" }),
    ).toBeInTheDocument();
  });
});

describe("FilterBar のクリアボタン", () => {
  it("すべての属性が null の場合はクリアボタンを表示しない", () => {
    render(<FilterBar {...createProps({ value: EMPTY_FILTER })} />);

    expect(
      screen.queryByRole("button", { name: "クリア" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    {
      name: "status のみ非 null",
      value: { status: "open", priority: null, assignee: null },
    },
    {
      name: "priority のみ非 null",
      value: { status: null, priority: "high", assignee: null },
    },
    {
      name: "assignee のみ非 null",
      value: {
        status: null,
        priority: null,
        assignee: "member_1" as Id<"members">,
      },
    },
  ] as const)("$name の場合はクリアボタンを表示する", ({ value }) => {
    render(<FilterBar {...createProps({ value })} />);

    expect(screen.getByRole("button", { name: "クリア" })).toBeInTheDocument();
  });

  it("クリアボタン押下で EMPTY_FILTER を渡して onChange を呼ぶ", async () => {
    const user = userEvent.setup();
    const onChange = createOnChange();
    const value: FilterState = {
      status: "open",
      priority: "high",
      assignee: "member_1" as Id<"members">,
    };
    render(<FilterBar {...createProps({ onChange, value })} />);

    await user.click(screen.getByRole("button", { name: "クリア" }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith(EMPTY_FILTER);
  });
});
