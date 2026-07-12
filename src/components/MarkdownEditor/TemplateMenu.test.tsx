import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TemplateMenu } from "./TemplateMenu";
import type { MarkdownTemplate } from "./templates";

/**
 * テンプレート選択メニューの振る舞い（一覧表示と選択の通知）を検証する。
 * カーソル位置への挿入はエディタ（ライブラリ）側の責務のためここでは扱わない。
 */

const createTemplate = (
  overrides: Partial<MarkdownTemplate> = {},
): MarkdownTemplate => ({
  name: "feature",
  label: "機能",
  content: "## 背景\n",
  ...overrides,
});

const createProps = (
  overrides: Partial<Parameters<typeof TemplateMenu>[0]> = {},
) => ({
  templates: [
    createTemplate(),
    createTemplate({ name: "bug", label: "バグ報告", content: "## 事象\n" }),
  ],
  onSelect: vi.fn<Parameters<typeof TemplateMenu>[0]["onSelect"]>(),
  ...overrides,
});

describe("TemplateMenu", () => {
  it("テンプレートを選択肢として一覧表示する", () => {
    render(<TemplateMenu {...createProps()} />);

    expect(screen.getByRole("menuitem", { name: "機能" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "バグ報告" })).toBeVisible();
  });

  it("選択したテンプレートを onSelect へ通知する", async () => {
    const user = userEvent.setup();
    const props = createProps();
    render(<TemplateMenu {...props} />);

    await user.click(screen.getByRole("menuitem", { name: "バグ報告" }));

    expect(props.onSelect).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ name: "bug", content: "## 事象\n" }),
    );
  });
});
