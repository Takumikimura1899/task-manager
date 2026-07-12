import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { Fragment, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { formatHoursTotal } from "../../lib/formatHours";
import { ISSUE_STATUS_LABELS, type IssueSummary } from "../../lib/issueMeta";
import { PRIORITY_LABELS } from "../../lib/taskMeta";
import { Badge } from "../Badge/Badge";
import { ConfirmPanel } from "../ConfirmPanel/ConfirmPanel";
import s from "./IssueTable.module.css";

/**
 * Issue の指標付き一覧テーブル。issues.list の購読は IssuesView に一本化し、
 * ここは props で受け取った配列を表示するだけ（削除ミューテーションのみ持つ）。
 */
export function IssueTable({
  issues,
  projectKey,
}: {
  issues: readonly IssueSummary[];
  projectKey: string;
}) {
  const removeIssue = useMutation(api.issues.remove);
  // 確認待ちは id のみ保持し、revision は固定しない。revision まで
  // pending に固定すると、パネル表示中に対象が外部（別タブ・MCP・
  // 他ユーザー）で更新／削除されても追従できない。表示可否・確定内容は
  // render のたびに issues から再導出する pendingIssue（対象が現存する
  // 場合のみ非 null）を基準にするため、id だけで十分。
  const [pending, setPending] = useState<Id<"issues"> | null>(null);
  // エラー再試行のためパネルを開いたまま await するので、実行中の
  // 二重確定や他行への pending 切替を防ぐ実行中フラグを持つ。
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // confirmDelete の完了ハンドラは in-flight 中に取得した pending の
  // 最新値を必要とする（クロージャの pending は呼び出し時点のまま更新
  // されない）。ref で常に最新値を追随させ、対象が完了時点でも pending の
  // ままかを判定する。
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const pendingIssue =
    pending !== null ? (issues.find((i) => i._id === pending) ?? null) : null;

  const requestDelete = (issue: IssueSummary) => {
    setError(null);
    setPending(issue._id);
  };

  const confirmDelete = async () => {
    if (pendingIssue === null || deleting) return;
    // 完了時点で対象が pending のままか判定するために、実行開始時点の id を
    // ローカルに固定する（pendingIssue はレンダーのたびに issues から
    // 再導出されるため、await 中に別行へ切り替わりうる）。
    const targetId = pendingIssue._id;
    setError(null);
    setDeleting(true);
    try {
      await removeIssue({
        id: pendingIssue._id,
        expectedRevision: pendingIssue.revision,
      });
      // pending が targetId のままの場合のみクリアする。対象消失後に
      // 別行のパネルが開いていれば、それを誤って閉じない。
      setPending((p) => (p === targetId ? null : p));
    } catch (err) {
      // pending が targetId のままの場合のみエラーを表示する。削除ボタンの
      // disabled（deleting 併用）で通常は到達しないが、状態誤帰属を
      // 構造的に不可能にする防御。
      if (pendingRef.current === targetId) {
        setError(
          err instanceof ConvexError ? String(err.data) : "削除に失敗しました",
        );
      }
    } finally {
      setDeleting(false);
    }
  };

  if (issues.length === 0) {
    return (
      <section className={s.panel}>
        <h2 className={s.heading}>Issue 一覧（0）</h2>
        <p className={s.empty}>Issue がありません。</p>
      </section>
    );
  }

  return (
    <section className={s.panel}>
      <h2 className={s.heading}>Issue 一覧（{issues.length}）</h2>
      <div className={s.wrapper}>
        <table className={s.table}>
          <thead>
            <tr>
              <th className={s.th} scope="col">
                Issue
              </th>
              <th className={s.th} scope="col">
                ステータス
              </th>
              <th className={s.th} scope="col">
                タイトル
              </th>
              <th className={s.th} scope="col">
                優先度
              </th>
              <th className={s.th} scope="col">
                タスク
              </th>
              <th className={s.th} scope="col">
                予想
              </th>
              <th className={s.th} scope="col">
                実績
              </th>
              <th className={s.th} scope="col">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            {issues.map((issue) => {
              const percent =
                issue.taskCount === 0
                  ? 0
                  : Math.round((issue.doneCount / issue.taskCount) * 100);
              const isPending =
                pendingIssue !== null && pendingIssue._id === issue._id;
              return (
                <Fragment key={issue._id}>
                  <tr>
                    <td className={`${s.td} ${s.ref}`}>
                      {projectKey}#{issue.number}
                    </td>
                    <td className={s.td}>
                      <Badge status={issue.status}>
                        {ISSUE_STATUS_LABELS[issue.status]}
                      </Badge>
                    </td>
                    <td className={s.td}>
                      <Link
                        className={s.titleLink}
                        to={`/${projectKey}/issues/${issue.number}`}
                      >
                        {issue.title}
                      </Link>
                    </td>
                    <td className={s.td}>{PRIORITY_LABELS[issue.priority]}</td>
                    <td className={s.td}>
                      <div className={s.progress}>
                        <progress
                          aria-label={`タスク進捗 ${issue.doneCount}/${issue.taskCount}`}
                          className={s.progressBar}
                          max={100}
                          value={percent}
                        />
                        <span className={`${s.progressText} ${s.numeric}`}>
                          {issue.doneCount}/{issue.taskCount}
                        </span>
                      </div>
                    </td>
                    {/* 合計 0 は「未入力」と区別できないため、予想・実績とも
                        「—」で未入力扱いに統一する（丸めて 0 になる極小値も
                        formatHoursTotal 側で同様に扱う）。 */}
                    <td className={`${s.td} ${s.numeric}`}>
                      {formatHoursTotal(issue.estimateTotal)}
                    </td>
                    <td className={`${s.td} ${s.numeric}`}>
                      {formatHoursTotal(issue.actualTotal)}
                    </td>
                    <td className={s.td}>
                      {/* 確認フロー進行中は他行の削除を受け付けない（実行中の
                          pending 切替で別行のパネルが閉じる競合を防ぐ）。
                          対象が外部で削除され pendingIssue が null に戻れば
                          自動的に再度有効になるが、削除 in-flight 中
                          （deleting）はそれでも新たなパネルを開かせない
                          （対象消失後に他行を開けてしまうと、in-flight の
                          完了ハンドラがその行を誤って操作しうるため）。 */}
                      <button
                        className={s.deleteButton}
                        disabled={pendingIssue !== null || deleting}
                        onClick={() => requestDelete(issue)}
                        type="button"
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                  {isPending && (
                    <tr>
                      <td className={s.confirmCell} colSpan={8}>
                        <ConfirmPanel
                          busy={deleting}
                          confirmLabel="削除する"
                          error={error}
                          message="この Issue と配下のタスク・Git 連携をすべて削除します。取り消せません。"
                          onCancel={() => setPending(null)}
                          onConfirm={() => void confirmDelete()}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
