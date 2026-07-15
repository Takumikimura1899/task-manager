import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SortState } from "../../lib/filterParams";
import { SortBar } from "./SortBar";

/**
 * SortState（field/dir の直積）と「並び替えなし/優先度 高い順/…」の
 * 1 select の相互変換を検証する（Issue #93）。値の適用ロジック（実際の
 * ソート）は IssuesView 側の責務なので対象外。
 */

type SortBarProps = Parameters<typeof SortBar>[0];

const createOnChange = () => vi.fn<(next: SortState) => void>();

const createProps = (overrides: Partial<SortBarProps> = {}): SortBarProps => ({
  value: null,
  onChange: createOnChange(),
  ...overrides,
});

describe("SortBar の選択肢と現在値の表示", () => {
  it.each([
    { value: null, expected: "並び替えなし（既定順）" },
    {
      value: { field: "priority", dir: "desc" },
      expected: "優先度 高い順",
    },
    {
      value: { field: "priority", dir: "asc" },
      expected: "優先度 低い順",
    },
    {
      value: { field: "updatedAt", dir: "desc" },
      expected: "更新が新しい順",
    },
    {
      value: { field: "updatedAt", dir: "asc" },
      expected: "更新が古い順",
    },
  ] as const)(
    "value=$value のとき「$expected」を選択済みにする",
    ({ value, expected }) => {
      render(<SortBar {...createProps({ value })} />);

      const option = screen.getByRole("option", {
        name: expected,
      }) as HTMLOptionElement;
      expect(option.selected).toBe(true);
    },
  );
});

describe("SortBar の値選択と onChange", () => {
  it.each([
    {
      label: "優先度 高い順",
      expected: { field: "priority", dir: "desc" },
    },
    {
      label: "優先度 低い順",
      expected: { field: "priority", dir: "asc" },
    },
    {
      label: "更新が新しい順",
      expected: { field: "updatedAt", dir: "desc" },
    },
    {
      label: "更新が古い順",
      expected: { field: "updatedAt", dir: "asc" },
    },
  ] as const)(
    "「$label」を選択すると対応する SortState で onChange を呼ぶ",
    async ({ label, expected }) => {
      const user = userEvent.setup();
      const onChange = createOnChange();
      render(<SortBar {...createProps({ onChange })} />);

      await user.selectOptions(screen.getByLabelText("並び替え"), label);

      expect(onChange).toHaveBeenCalledExactlyOnceWith(expected);
    },
  );

  it("「並び替えなし（既定順）」を選択すると null で onChange を呼ぶ", async () => {
    const user = userEvent.setup();
    const onChange = createOnChange();
    render(
      <SortBar
        {...createProps({
          onChange,
          value: { field: "priority", dir: "desc" },
        })}
      />,
    );

    await user.selectOptions(
      screen.getByLabelText("並び替え"),
      "並び替えなし（既定順）",
    );

    expect(onChange).toHaveBeenCalledExactlyOnceWith(null);
  });
});
