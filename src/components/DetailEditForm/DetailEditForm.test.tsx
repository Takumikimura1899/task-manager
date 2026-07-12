import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DetailEditForm } from "./DetailEditForm";

/**
 * 詳細画面共通の編集フォームの表示（ラベル付き入力・保存可否・
 * エラーの SR 通知・競合時の再読込導線）を検証する。
 * 状態は呼び出し側が持つため、props 経由のコールバック発火を確認する。
 *
 * MarkdownEditor（@uiw/react-md-editor）は jsdom で不安定な API に依存する
 * 重量ライブラリのため、同じ contract（value/onChange/ariaLabel）を持つ
 * textarea スタブへ差し替える。エディタ自体の振る舞いはライブラリ責務。
 */

vi.mock("../MarkdownEditor/MarkdownEditor", () => ({
  MarkdownEditor: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string;
    onChange: (value: string) => void;
    ariaLabel: string;
  }) => (
    <textarea
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      value={value}
    />
  ),
}));

type Props = Parameters<typeof DetailEditForm>[0];

const createProps = (overrides: Partial<Props> = {}): Props => ({
  formLabel: "Issue を編集",
  title: "元のタイトル",
  description: "元の説明",
  onTitle: vi.fn<Props["onTitle"]>(),
  onDescription: vi.fn<Props["onDescription"]>(),
  onSubmit: vi.fn<Props["onSubmit"]>((e) => e.preventDefault()),
  onCancel: vi.fn<Props["onCancel"]>(),
  error: null,
  conflict: false,
  onReload: vi.fn<Props["onReload"]>(),
  saving: false,
  templates: [],
  ...overrides,
});

describe("DetailEditForm", () => {
  it("ラベル付きのタイトル・説明入力に現在値を表示する", async () => {
    render(<DetailEditForm {...createProps()} />);

    expect(screen.getByRole("form", { name: "Issue を編集" })).toBeVisible();
    expect(screen.getByLabelText("タイトル")).toHaveValue("元のタイトル");
    // 説明エディタは lazy ロードのため findBy で解決を待つ
    expect(await screen.findByLabelText("説明")).toHaveValue("元の説明");
  });

  it("入力の変更がコールバックへ伝わる", async () => {
    const user = userEvent.setup();
    const props = createProps();
    render(<DetailEditForm {...props} />);

    await user.type(screen.getByLabelText("タイトル"), "あ");
    await user.type(await screen.findByLabelText("説明"), "い");

    expect(props.onTitle).toHaveBeenCalledWith("元のタイトルあ");
    expect(props.onDescription).toHaveBeenCalledWith("元の説明い");
  });

  it.each([
    ["タイトルが空白のみ", { title: "   " }],
    ["保存中", { saving: true }],
  ])("%sのとき保存を無効化する", (_case, overrides) => {
    render(<DetailEditForm {...createProps(overrides)} />);

    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  it("キャンセルで onCancel を呼ぶ", async () => {
    const user = userEvent.setup();
    const props = createProps();
    render(<DetailEditForm {...props} />);

    await user.click(screen.getByRole("button", { name: "キャンセル" }));

    expect(props.onCancel).toHaveBeenCalledOnce();
  });

  it("エラーは role=alert で表示し、競合でなければ再読込導線は出さない", () => {
    render(
      <DetailEditForm
        {...createProps({ error: "保存に失敗しました", conflict: false })}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("保存に失敗しました");
    expect(
      screen.queryByRole("button", {
        name: "最新の内容を読み込んで編集し直す",
      }),
    ).not.toBeInTheDocument();
  });

  it("競合時は再読込導線を表示し、クリックで onReload を呼ぶ", async () => {
    const user = userEvent.setup();
    const props = createProps({
      error: "競合が発生しました。",
      conflict: true,
    });
    render(<DetailEditForm {...props} />);

    await user.click(
      screen.getByRole("button", { name: "最新の内容を読み込んで編集し直す" }),
    );

    expect(props.onReload).toHaveBeenCalledOnce();
  });
});
