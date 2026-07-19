import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignIn } from "./SignIn";

/**
 * SignIn 画面（Issue #1）のログイン / 新規登録フローを検証する。
 * 認証は外部依存（@convex-dev/auth）のためモックし、signIn 呼び出しの
 * 引数とエラー表示（ConvexError はサーバ文言・それ以外は定型文言）を
 * 観測可能な結果として検証する。
 */

const { signIn } = vi.hoisted(() => ({
  signIn: vi.fn<(provider: string, params: unknown) => Promise<unknown>>(),
}));

vi.mock("@convex-dev/auth/react", async () => {
  const { buildConvexAuthActionsMock } =
    await import("../../../test/reactQuerySupport");
  return buildConvexAuthActionsMock({
    signIn: signIn as (...args: unknown[]) => Promise<unknown>,
  });
});

beforeEach(() => {
  signIn.mockReset();
  signIn.mockResolvedValue(undefined);
});

const fillCredentials = async (
  user: ReturnType<typeof userEvent.setup>,
  email = "taro@example.com",
  password = "password1234",
) => {
  await user.type(screen.getByLabelText("メールアドレス"), email);
  await user.type(screen.getByLabelText("パスワード"), password);
};

describe("SignIn のログインフロー", () => {
  it("メールアドレスとパスワードの両方を入力するまで送信できない", async () => {
    const user = userEvent.setup();
    render(<SignIn />);

    const submit = screen.getByRole("button", { name: "ログイン" });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText("メールアドレス"), "a@example.com");
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText("パスワード"), "password1234");
    expect(submit).toBeEnabled();
  });

  it("送信すると前後空白を除いた email と flow=signIn で signIn を呼ぶ", async () => {
    const user = userEvent.setup();
    render(<SignIn />);

    await fillCredentials(user, "  taro@example.com  ");
    await user.click(screen.getByRole("button", { name: "ログイン" }));

    expect(signIn).toHaveBeenCalledWith("password", {
      email: "taro@example.com",
      password: "password1234",
      flow: "signIn",
    });
  });

  it("失敗（資格情報エラー等の内部例外）は定型文言に丸めて表示し、再送信できる", async () => {
    const user = userEvent.setup();
    signIn.mockRejectedValueOnce(new Error("InvalidSecret"));
    render(<SignIn />);

    await fillCredentials(user);
    await user.click(screen.getByRole("button", { name: "ログイン" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "ログインに失敗しました。メールアドレスとパスワードを確認してください。",
    );
    // 内部エラーの詳細（InvalidSecret）を生で晒さない
    expect(screen.getByRole("alert")).not.toHaveTextContent("InvalidSecret");
    expect(screen.getByRole("button", { name: "ログイン" })).toBeEnabled();
  });
});

describe("SignIn の新規登録フロー", () => {
  it("「新規登録へ」で切り替えると flow=signUp で signIn を呼ぶ", async () => {
    const user = userEvent.setup();
    render(<SignIn />);

    await user.click(screen.getByRole("button", { name: "新規登録へ" }));
    await fillCredentials(user);
    await user.click(screen.getByRole("button", { name: "新規登録" }));

    expect(signIn).toHaveBeenCalledWith("password", {
      email: "taro@example.com",
      password: "password1234",
      flow: "signUp",
    });
  });

  it("サーバが意図して投げた ConvexError はその文言をそのまま表示する", async () => {
    const user = userEvent.setup();
    const invited =
      "このメールアドレスは招待されていません。管理者にメンバー登録を依頼してください。";
    signIn.mockRejectedValueOnce(new ConvexError(invited));
    render(<SignIn />);

    await user.click(screen.getByRole("button", { name: "新規登録へ" }));
    await fillCredentials(user, "attacker@example.com");
    await user.click(screen.getByRole("button", { name: "新規登録" }));

    expect(screen.getByRole("alert")).toHaveTextContent(invited);
  });

  it("フローを切り替えると前のエラー表示を消す", async () => {
    const user = userEvent.setup();
    signIn.mockRejectedValueOnce(new Error("boom"));
    render(<SignIn />);

    await fillCredentials(user);
    await user.click(screen.getByRole("button", { name: "ログイン" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "新規登録へ" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("SignIn の送信中表示", () => {
  it("送信中はボタンを無効化して進行表示にする（成功時はゲート切替までそのまま）", async () => {
    const user = userEvent.setup();
    let resolveSignIn: (() => void) | undefined;
    signIn.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSignIn = resolve;
        }),
    );
    render(<SignIn />);

    await fillCredentials(user);
    await user.click(screen.getByRole("button", { name: "ログイン" }));

    expect(screen.getByRole("button", { name: "送信中…" })).toBeDisabled();

    resolveSignIn?.();
  });
});
