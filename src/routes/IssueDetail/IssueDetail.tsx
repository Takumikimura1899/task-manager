import { useMutation, useQuery } from "convex/react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { AddTaskForm } from "../../components/AddTaskForm/AddTaskForm";
import { Badge } from "../../components/Badge/Badge";
import { ConfirmPanel } from "../../components/ConfirmPanel/ConfirmPanel";
import { DetailEditForm } from "../../components/DetailEditForm/DetailEditForm";
import { DetailMeta } from "../../components/DetailMeta/DetailMeta";
import { Markdown } from "../../components/Markdown/Markdown";
import { ISSUE_TEMPLATES } from "../../components/MarkdownEditor/templates";
import { NoMembersNotice } from "../../components/NoMembersNotice/NoMembersNotice";
import { Skeleton } from "../../components/Skeleton/Skeleton";
import { TaskCard } from "../../components/TaskCard/TaskCard";
import { useCurrentMember } from "../../hooks/useCurrentMember";
import { useDeleteFlow } from "../../hooks/useDeleteFlow";
import { useEditForm } from "../../hooks/useEditForm";
import { formatIssueRef } from "../../lib/formatIssueRef";
import { ISSUE_STATUS_LABELS } from "../../lib/issueMeta";
import { parseRefNumber } from "../../lib/routeParams";
import {
  PRIORITY_LABELS,
  PRIORITY_OPTIONS,
  type Priority,
  TASK_STATUS_LABELS,
  TASK_STATUS_ORDER,
} from "../../lib/taskMeta";
import s from "./IssueDetail.module.css";

/**
 * 編集フォームの下書き（タイトル・説明・優先度）。
 * revision は編集開始時点の値を保持し、保存時の expectedRevision に使う。
 * 購読中の最新値を使うと、編集中の他者更新で expectedRevision も追従して
 * しまい競合を検知できないため（Issue #73）。
 */
type IssueDraft = {
  title: string;
  description: string;
  priority: Priority;
  revision: number;
};

// 読み込み中もページ枠と戻り導線を維持し、見出し・本文セクションの矩形を
// スケルトンで示す（Issue #29：全画面差し替えをやめる）。props/state に
// 依存しない静的な表示のためコンポーネント外に定義する（呼び出し側が
// サンクとして呼ぶことで、読み込み完了後の再レンダーでは要素木を作らない・
// Issue #104 レビュー対応）。
const renderLoading = () => (
  <main className={s.page}>
    <Link className={s.back} to="/issues">
      ← 一覧へ
    </Link>
    <output aria-label="Issue を読み込み中" className={s.loading}>
      <Skeleton className={s.skeletonHeading} />
      <Skeleton className={s.skeletonTitle} />
      <Skeleton className={s.skeletonSection} />
      <Skeleton className={s.skeletonSection} />
    </output>
  </main>
);

export function IssueDetail() {
  const params = useParams();
  const projectKey = params.projectKey ?? "";
  const number = parseRefNumber(params.number);
  const navigate = useNavigate();

  const issue = useQuery(
    api.issues.getByRef,
    number !== null ? { projectKey, number } : "skip",
  );
  // 担当者選択肢（members）は AddTaskForm 側で不要のため購読しない
  const { currentMember, currentMemberLoading } = useCurrentMember({
    withMembers: false,
  });

  const updateIssue = useMutation(api.issues.update);
  const removeIssue = useMutation(api.issues.remove);
  // 保存時の expectedRevision は編集開始時点の revision（draft.revision）を
  // 送る（INVARIANT-2）。編集中に他者が更新していれば競合として検知される。
  const edit = useEditForm<IssueDraft>({
    save: async (draft) => {
      if (issue === null || issue === undefined) return;
      await updateIssue({
        id: issue._id,
        expectedRevision: draft.revision,
        title: draft.title.trim(),
        description: draft.description,
        priority: draft.priority,
      });
    },
  });

  // 破壊的操作（削除）の確認フロー。busy 中は ConfirmPanel を disabled にし
  // 二重実行を防ぐ。パネルを開いたまま await し busy/error を表示する
  // （確定前に閉じると失敗がサイレントになるため）。一覧行末の削除導線
  // （旧 IssueTable）は #105 で撤去済みで、本画面の danger セクションが
  // Issue の唯一の削除導線になっている。
  // number スコープ・client-side 遷移時のリセットはフック側の責務
  // （src/hooks/useDeleteFlow.ts・Issue #104）。
  const deleteFlow = useDeleteFlow({
    number,
    remove: async () => {
      if (issue === null || issue === undefined) return;
      await removeIssue({ id: issue._id, expectedRevision: issue.revision });
    },
    onDeleted: () => navigate("/issues"), // 削除後は Issue 一覧へ戻る
  });

  const renderNotFound = () => (
    <main className={s.page}>
      <Link className={s.back} to="/issues">
        ← 一覧へ
      </Link>
      <p className="hint">Issue が見つかりませんでした。</p>
      {/* 並行削除（他ユーザーが先に削除）と自分の削除失敗が重なった場合、
          issue===null で notFound へ来てしまい ConfirmPanel 内のエラー表示に
          到達できない。ここで拾わないとサイレント失敗になる（Issue #104）。 */}
      {deleteFlow.error !== null && (
        <p className="actionError" role="alert">
          {deleteFlow.error}
        </p>
      )}
    </main>
  );

  if (number === null) {
    return renderNotFound();
  }

  if (issue === undefined) {
    return renderLoading();
  }

  if (issue === null) {
    // 削除確定（useDeleteFlow の remove）後、navigate 到達までの間に
    // getByRef の購読が read-your-writes で先に null を返すことがある。
    // 削除対象の number と現在表示中の number が一致する場合のみローディング
    // に留め、一致しなければ本当に見つからない（無効な参照・外部での削除等・
    // 削除 in-flight 中に別の Issue へ遷移した後にその Issue が存在しない
    // 場合）。
    return deleteFlow.isDeletingCurrent ? renderLoading() : renderNotFound();
  }

  const status = issue.status;
  // 進捗は canceled を除いた「実行対象」で集計する（派生ステータスと同基準・§5.1）。
  const activeTasks = issue.tasks.filter((t) => t.status !== "canceled");
  const doneCount = activeTasks.filter((t) => t.status === "done").length;

  // 編集の初期値・競合後の再読込は常に最新の購読値から作る。
  const toDraft = (): IssueDraft => ({
    title: issue.title,
    description: issue.description ?? "",
    priority: issue.priority,
    revision: issue.revision,
  });

  return (
    <main className={s.page}>
      <Link className={s.back} to="/issues">
        ← 一覧へ
      </Link>

      <header className={s.header}>
        <div className={s.heading}>
          <span className={s.ref}>{formatIssueRef(issue.number)}</span>
          <Badge status={status}>{ISSUE_STATUS_LABELS[status]}</Badge>
          {!edit.editing && (
            <button
              className={s.edit}
              onClick={() => edit.open(toDraft())}
              type="button"
            >
              編集
            </button>
          )}
        </div>
        {/* ステータスバッジは配下 Task から自動算出される派生値のため、
            遷移ボタンの代わりに説明文を置く（基本設計書§5.1 ADR-10） */}
        <p className="hintSm">ステータスは配下 Task から自動算出されます</p>
        {!edit.editing && (
          <>
            <h1 className={s.title}>{issue.title}</h1>
            <p className={s.progress}>
              Task {doneCount}/{activeTasks.length} 完了
            </p>
          </>
        )}
      </header>

      {edit.editing && edit.draft !== null ? (
        <section className={s.section}>
          <DetailEditForm
            conflict={edit.conflict}
            description={edit.draft.description}
            error={edit.error}
            formLabel="Issue を編集"
            onCancel={edit.close}
            onDescription={(description) => edit.update({ description })}
            onReload={() => edit.open(toDraft())}
            onSubmit={edit.submit}
            onTitle={(title) => edit.update({ title })}
            saving={edit.saving}
            templates={ISSUE_TEMPLATES}
            title={edit.draft.title}
          >
            <label className={s.editField}>
              優先度
              <select
                className={s.editSelect}
                onChange={(e) =>
                  edit.update({ priority: e.target.value as Priority })
                }
                value={edit.draft.priority}
              >
                {PRIORITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </DetailEditForm>
        </section>
      ) : (
        issue.description !== undefined &&
        issue.description !== "" && (
          <section className={s.section}>
            <Markdown>{issue.description}</Markdown>
          </section>
        )
      )}

      <section className={s.section}>
        <h2 className={s.sectionTitle}>Task（{issue.tasks.length}）</h2>
        {TASK_STATUS_ORDER.map((taskStatus) => {
          const tasks = issue.tasks.filter((t) => t.status === taskStatus);
          if (tasks.length === 0) return null;
          return (
            <div className={s.group} key={taskStatus}>
              <h3 className={s.groupTitle}>
                {TASK_STATUS_LABELS[taskStatus]}（{tasks.length}）
              </h3>
              <div className={s.cards}>
                {tasks.map((task) => (
                  <TaskCard
                    assigneeName={task.assigneeName}
                    key={task._id}
                    projectKey={issue.projectKey}
                    task={task}
                  />
                ))}
              </div>
            </div>
          );
        })}
        {currentMember !== null ? (
          <AddTaskForm createdBy={currentMember._id} issue={issue._id} />
        ) : (
          // Member 未リンクでは作成手段が消えるため、黙って隠さず理由を案内する
          // （Issue #16 / #1、AppLayout.tsx と同方針）。members.me 読み込み中は
          // 判定できないため何も出さない。
          !currentMemberLoading && <NoMembersNotice />
        )}
      </section>

      <section className={s.section}>
        <dl className={s.props}>
          <dt className={s.term}>優先度</dt>
          <dd className={s.value}>{PRIORITY_LABELS[issue.priority]}</dd>
        </dl>
      </section>

      <section className={s.section}>
        <DetailMeta
          createdAt={issue._creationTime}
          createdByName={issue.createdByName}
          updatedAt={issue.updatedAt}
        />
      </section>

      <section className="dangerSection">
        <h2 className={s.sectionTitle}>操作</h2>
        <button
          className="dangerOutline"
          onClick={deleteFlow.request}
          type="button"
        >
          Issue を削除
        </button>
        {deleteFlow.confirming && (
          <ConfirmPanel
            busy={deleteFlow.busy}
            confirmLabel="削除する"
            error={deleteFlow.error}
            message="この Issue と配下の Task・Git 連携をすべて削除します。取り消せません。"
            onCancel={deleteFlow.cancel}
            onConfirm={deleteFlow.confirm}
          />
        )}
      </section>
    </main>
  );
}
