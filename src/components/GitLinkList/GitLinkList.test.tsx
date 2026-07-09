import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { GitLinkList, type GitLinkItem } from "./GitLinkList";
import s from "./GitLinkList.module.css";

/**
 * Git リンク一覧の表示内容（種別ラベル・リンク化の可否・
 * PR 状態バッジのラベルとスタイル）を検証する。
 */

const createLink = (overrides: Partial<GitLinkItem> = {}): GitLinkItem => ({
  _id: "gitlink_1" as Id<"gitLinks">,
  _creationTime: 1000,
  task: "task_1" as Id<"tasks">,
  repository: "repo_1" as Id<"repositories">,
  type: "branch",
  externalRef: "feature/login-fix",
  url: "https://github.com/example/repo/tree/feature/login-fix",
  remoteUrl: "https://github.com/example/repo",
  ...overrides,
});

describe("GitLinkList", () => {
  it("リンクが空のときは案内文を表示する", () => {
    render(<GitLinkList links={[]} />);

    expect(
      screen.getByText("連携している Git 情報はありません。"),
    ).toBeInTheDocument();
  });

  it.each([
    ["branch", "ブランチ"],
    ["commit", "コミット"],
    ["pull_request", "PR"],
  ] as const)("type=%s のとき種別ラベル「%s」を表示する", (type, label) => {
    render(<GitLinkList links={[createLink({ type })]} />);

    expect(screen.getByText(label)).toHaveClass(s.type);
  });

  it("http(s) の URL は新しいタブで開くリンクとして表示する", () => {
    render(<GitLinkList links={[createLink()]} />);

    const link = screen.getByRole("link", { name: "feature/login-fix" });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/example/repo/tree/feature/login-fix",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveClass(s.ref);
  });

  it("http(s) 以外のスキームはリンク化せずプレーンテキストで表示する", () => {
    render(
      <GitLinkList links={[createLink({ url: "javascript:alert(1)" })]} />,
    );

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("feature/login-fix")).toHaveClass(s.ref);
  });

  it.each([
    ["draft", "下書き"],
    ["open", "オープン"],
    ["merged", "マージ済み"],
    ["closed", "クローズ"],
  ] as const)(
    "prState=%s のときバッジ「%s」を状態別スタイルで表示する",
    (prState, label) => {
      render(
        <GitLinkList links={[createLink({ type: "pull_request", prState })]} />,
      );

      const badge = screen.getByText(label);
      expect(badge).toHaveClass(s.state, s[prState]);
    },
  );

  it("prState が未指定なら状態バッジを表示しない", () => {
    render(<GitLinkList links={[createLink({ type: "commit" })]} />);

    expect(screen.queryByText("オープン")).not.toBeInTheDocument();
    expect(screen.queryByText("下書き")).not.toBeInTheDocument();
  });
});
