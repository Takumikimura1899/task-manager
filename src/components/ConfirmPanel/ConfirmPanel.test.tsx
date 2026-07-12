import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmPanel } from "./ConfirmPanel";

/**
 * 破壊的操作の確認パネル（IssueTable の削除確認・TaskDetail の遷移/削除確認で
 * 共有）。表示内容・確定/キャンセルの呼び出し・busy 時の disabled・
 * role=alert のエラー表示を検証する。
 */

const createDefaultProps = () => ({
  message: "この操作は取り消せません。",
  confirmLabel: "削除する",
  onConfirm: vi.fn<() => void>(),
  onCancel: vi.fn<() => void>(),
});

describe("ConfirmPanel の表示内容", () => {
  it("メッセージと確定ラベルを表示する", () => {
    render(<ConfirmPanel {...createDefaultProps()} />);

    expect(screen.getByText("この操作は取り消せません。")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "削除する" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "キャンセル" }),
    ).toBeInTheDocument();
  });

  it("error を渡さない場合は role=alert を表示しない", () => {
    render(<ConfirmPanel {...createDefaultProps()} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("error を渡すと role=alert で表示する", () => {
    render(
      <ConfirmPanel {...createDefaultProps()} error="削除に失敗しました" />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("削除に失敗しました");
  });
});

describe("ConfirmPanel の操作", () => {
  it("確定ボタンで onConfirm を呼ぶ", async () => {
    const user = userEvent.setup();
    const props = createDefaultProps();
    render(<ConfirmPanel {...props} />);

    await user.click(screen.getByRole("button", { name: "削除する" }));

    expect(props.onConfirm).toHaveBeenCalledTimes(1);
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it("キャンセルボタンで onCancel を呼ぶ", async () => {
    const user = userEvent.setup();
    const props = createDefaultProps();
    render(<ConfirmPanel {...props} />);

    await user.click(screen.getByRole("button", { name: "キャンセル" }));

    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it("busy のときは確定・キャンセルとも disabled にする", () => {
    render(<ConfirmPanel {...createDefaultProps()} busy />);

    expect(screen.getByRole("button", { name: "削除する" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "キャンセル" })).toBeDisabled();
  });

  it("busy を渡さない場合は確定・キャンセルとも有効", () => {
    render(<ConfirmPanel {...createDefaultProps()} />);

    expect(screen.getByRole("button", { name: "削除する" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "キャンセル" })).toBeEnabled();
  });
});
