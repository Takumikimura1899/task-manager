import { describe, expect, it } from "vitest";
import {
  type GitEventKind,
  transitionForGitEvent,
} from "./gitAutomation";
import type { TaskStatus } from "./taskStatus";

/**
 * Git 駆動の自動遷移（§5 マッピング表）の振る舞いを検証する。
 * 「前進のみ・手動操作を上書きしない」原則が守られることを確認する。
 */
describe("transitionForGitEvent", () => {
  describe("適用される遷移（§5 マッピング表どおり）", () => {
    it.each([
      { kind: "branch_created", from: "todo", to: "in_progress" },
      { kind: "pr_opened", from: "todo", to: "in_progress" },
      { kind: "pr_ready", from: "in_progress", to: "in_review" },
      { kind: "pr_merged", from: "in_review", to: "done" },
      // PR closed（未マージ）: in_review からは差し戻し
      { kind: "pr_closed", from: "in_review", to: "in_progress" },
    ] satisfies { kind: GitEventKind; from: TaskStatus; to: TaskStatus }[])(
      "$kind: $from → $to",
      ({ kind, from, to }) => {
        expect(transitionForGitEvent(kind, from)).toBe(to);
      },
    );
  });

  describe("適用されない（null）= 前進しすぎ・手動操作の尊重", () => {
    it.each([
      // ブランチ作成は todo のときだけ。backlog からはスキップ前進不可
      { kind: "branch_created", from: "backlog" },
      // 既に in_progress 以降に進んでいれば何もしない
      { kind: "branch_created", from: "in_progress" },
      { kind: "pr_opened", from: "in_review" },
      // 手動で done にしたものを PR イベントで戻さない
      { kind: "pr_opened", from: "done" },
      { kind: "pr_closed", from: "done" },
      { kind: "pr_merged", from: "todo" }, // in_review 以外からは done にしない
      // 既に目標と同じ
      { kind: "pr_ready", from: "in_review" },
      { kind: "pr_merged", from: "done" },
      // canceled は終端。自動遷移しない
      { kind: "pr_merged", from: "canceled" },
      { kind: "branch_created", from: "canceled" },
    ] satisfies { kind: GitEventKind; from: TaskStatus }[])(
      "$kind: $from → 変化なし",
      ({ kind, from }) => {
        expect(transitionForGitEvent(kind, from)).toBeNull();
      },
    );
  });
});
