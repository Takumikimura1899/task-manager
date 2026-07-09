import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  type GitHubPullRequest,
  commitToEvent,
  parseGitHubRepo,
  prSnapshotToEvent,
  prUpdatedSince,
} from "./githubReconcile";

/**
 * Webhook reconcile の純粋ロジック（GitHub API レスポンス → イベント変換）の
 * 単体テスト。既存 Webhook 経路への流し込み・冪等化は convex/reconcile.test.ts
 * の結合テストで検証し、ここでは変換規則を固定する。
 */

const repo = {
  repositoryId: "repo1" as Id<"repositories">,
  projectId: "proj1" as Id<"projects">,
};

describe("parseGitHubRepo", () => {
  it.each([
    { name: "https", url: "https://github.com/acme/repo" },
    { name: "https + .git", url: "https://github.com/acme/repo.git" },
    { name: "https + 末尾スラッシュ", url: "https://github.com/acme/repo/" },
    { name: "scp 形式（git@）", url: "git@github.com:acme/repo.git" },
    { name: "ssh://", url: "ssh://git@github.com/acme/repo.git" },
  ])("$name の URL から owner/repo を取り出す", ({ url }) => {
    expect(parseGitHubRepo(url)).toEqual({ owner: "acme", repo: "repo" });
  });

  it("ドット・ハイフンを含む owner/repo を取り出せる", () => {
    expect(parseGitHubRepo("https://github.com/my-org/my.repo-2.git")).toEqual({
      owner: "my-org",
      repo: "my.repo-2",
    });
  });

  it.each([
    { name: "GitHub 以外のホスト", url: "https://gitlab.com/acme/repo" },
    { name: "owner のみ", url: "https://github.com/acme" },
    { name: "空文字", url: "" },
  ])("$name は null を返す", ({ url }) => {
    expect(parseGitHubRepo(url)).toBeNull();
  });
});

/** GitHub REST API の PR オブジェクトのファクトリ。 */
const createPr = (
  overrides: Partial<GitHubPullRequest> = {},
): GitHubPullRequest => ({
  number: 5,
  state: "open",
  draft: false,
  merged_at: null,
  html_url: "https://github.com/acme/repo/pull/5",
  title: "TASK-1 ログイン修正",
  body: "説明",
  updated_at: "2026-07-09T10:00:00Z",
  head: { ref: "feature/TASK-1" },
  ...overrides,
});

describe("prSnapshotToEvent", () => {
  it("PR スナップショットを pull_request イベントに変換する（deliveryId は reconcile 形式）", () => {
    const { deliveryId, event } = prSnapshotToEvent(createPr(), repo);

    expect(deliveryId).toBe("reconcile:repo1:pr:5:2026-07-09T10:00:00Z");
    expect(event).toEqual({
      kind: "pull_request",
      repositoryId: repo.repositoryId,
      projectId: repo.projectId,
      action: "opened",
      merged: false,
      draft: false,
      number: 5,
      url: "https://github.com/acme/repo/pull/5",
      title: "TASK-1 ログイン修正",
      body: "説明",
      branch: "feature/TASK-1",
    });
  });

  it.each([
    {
      name: "open（Draft）は opened + draft",
      overrides: { draft: true },
      expected: { action: "opened", merged: false, draft: true },
    },
    {
      name: "closed（マージ済み）は closed + merged",
      overrides: { state: "closed", merged_at: "2026-07-09T09:00:00Z" },
      expected: { action: "closed", merged: true, draft: false },
    },
    {
      name: "closed（未マージ）は closed + merged=false",
      overrides: { state: "closed" },
      expected: { action: "closed", merged: false, draft: false },
    },
  ])("$name に変換する", ({ overrides, expected }) => {
    const { event } = prSnapshotToEvent(createPr(overrides), repo);
    expect(event).toMatchObject(expected);
  });

  it("欠落フィールドは防御的に既定値へ変換する（外部入力のため throw しない）", () => {
    const { event } = prSnapshotToEvent({}, repo);
    expect(event).toMatchObject({
      action: "opened",
      merged: false,
      draft: false,
      number: 0,
      url: "",
      title: "",
      body: "",
      branch: "",
    });
  });
});

describe("commitToEvent", () => {
  it("commit を 1 commit の push イベントに変換する（deliveryId は sha で同定）", () => {
    const { deliveryId, event } = commitToEvent(
      {
        sha: "abc123",
        html_url: "https://github.com/acme/repo/commit/abc123",
        commit: { message: "[TASK-1] fix: バグ修正" },
      },
      repo,
    );

    expect(deliveryId).toBe("reconcile:repo1:commit:abc123");
    expect(event).toEqual({
      kind: "push",
      repositoryId: repo.repositoryId,
      projectId: repo.projectId,
      commits: [
        {
          message: "[TASK-1] fix: バグ修正",
          sha: "abc123",
          url: "https://github.com/acme/repo/commit/abc123",
        },
      ],
    });
  });
});

describe("prUpdatedSince", () => {
  const since = "2026-07-09T09:00:00Z";

  it.each([
    {
      name: "ウィンドウ内の更新",
      updated_at: "2026-07-09T09:30:00Z",
      expected: true,
    },
    { name: "ちょうど境界", updated_at: since, expected: true },
    {
      name: "ウィンドウ外（古い）",
      updated_at: "2026-07-09T08:59:59Z",
      expected: false,
    },
    { name: "updated_at 欠落", updated_at: undefined, expected: false },
  ])("$name は $expected", ({ updated_at, expected }) => {
    expect(prUpdatedSince(createPr({ updated_at }), since)).toBe(expected);
  });
});
