import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useEffect, useRef, useState } from "react";
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

export function IssueDetail() {
  const params = useParams();
  const projectKey = params.projectKey ?? "";
  const number = parseRefNumber(params.number);
  const navigate = useNavigate();
  // 表示中の number を常に最新化する ref。削除確定後の非同期継続処理
  // （confirmDelete）が、実行中に client-side 遷移で表示先が切り替わって
  // いないかを判定するために使う（Issue #104 追加対応）。
  const numberRef = useRef(number);
  numberRef.current = number;

  const issue = useQuery(
    api.issues.getByRef,
    number !== null ? { projectKey, number } : "skip",
  );
  const { members, currentMember } = useCurrentMember();

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

  // 破壊的操作（削除）の確認待ち状態。busy 中は ConfirmPanel を disabled にし
  // 二重実行を防ぐ（IssueTable の削除確認と同方式：パネルを開いたまま
  // await し、busy/error を渡す。IssueTable 側の行内削除導線は #105 で
  // 撤去され、本画面の danger セクションが唯一の削除導線になる）。
  // deletingNumber は「削除確定 = busy」だけでなく削除対象の number も
  // 保持する。同一マウントのまま別の Issue へ client-side 遷移された場合に、
  // 別 Issue の表示へ誤って波及させないためのスコープに使う
  // （Issue #104 追加対応）。
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletingNumber, setDeletingNumber] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // number が変わったら（同一マウントのまま別の Issue へ client-side 遷移
  // した場合）確認パネルの開閉状態と削除エラーをリセットする。放置すると
  // 別の Issue の画面に前の Issue 用の削除確認パネルやエラーが残ったまま
  // 表示されてしまう（deletingNumber は削除対象自体を正しくスコープして
  // いるためリセット対象に含めない・Issue #104 追加対応）。
  useEffect(() => {
    setConfirmingDelete(false);
    setDeleteError(null);
  }, [number]);

  const notFound = (
    <main className={s.page}>
      <Link className={s.back} to="/issues">
        ← 一覧へ
      </Link>
      <p className="hint">Issue が見つかりませんでした。</p>
      {/* 並行削除（他ユーザーが先に削除）と自分の削除失敗が重なった場合、
          issue===null で notFound へ来てしまい ConfirmPanel 内のエラー表示に
          到達できない。ここで拾わないとサイレント失敗になる（Issue #104）。 */}
      {deleteError !== null && (
        <p className={s.actionError} role="alert">
          {deleteError}
        </p>
      )}
    </main>
  );

  // 読み込み中もページ枠と戻り導線を維持し、見出し・本文セクションの
  // 矩形をスケルトンで示す（Issue #29：全画面差し替えをやめる）。
  const loading = (
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

  if (number === null) {
    return notFound;
  }

  if (issue === undefined) {
    return loading;
  }

  if (issue === null) {
    // 削除確定（confirmDelete）後、navigate 到達までの間に getByRef の
    // 購読が read-your-writes で先に null を返すことがある。削除対象の
    // number と現在表示中の number が一致する場合のみローディングに留め、
    // 一致しなければ本当に見つからない（無効な参照・外部での削除等・
    // 削除 in-flight 中に別の Issue へ遷移した後にその Issue が存在しない
    // 場合）。
    return deletingNumber === number ? loading : notFound;
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

  const requestDelete = () => {
    setDeleteError(null);
    setConfirmingDelete(true);
  };

  const confirmDelete = async () => {
    if (deletingNumber !== null) return;
    setDeleteError(null);
    setDeletingNumber(number);
    const target = number;
    try {
      await removeIssue({ id: issue._id, expectedRevision: issue.revision });
    } catch (err) {
      setDeleteError(
        err instanceof ConvexError ? String(err.data) : "削除に失敗しました",
      );
      setDeletingNumber(null);
      return;
    }
    // navigate は try の外で呼ぶ。try 内に置くと navigate 自体が投げた場合に
    // 削除は成功しているのに「削除に失敗しました」と誤表示してしまう。
    // さらに、完了時点で表示中の number（numberRef.current）が削除対象
    // （target）と一致する場合のみ遷移する。in-flight 中に別の Issue へ
    // client-side 遷移されていた場合、無関係な画面を強制的に一覧へ飛ばす
    // のを防ぐ（Issue #104 追加対応）。一致しなければ deletingNumber だけ
    // 戻す（この target を表示中の画面へ戻ってきたとき、既に削除済みの
    // number に対して deletingNumber===number が成立し続けてローディング
    // 表示のまま固まるのを防ぐため）。
    if (numberRef.current === target) {
      navigate("/issues"); // 削除後は Issue 一覧へ戻る
    } else {
      setDeletingNumber(null);
    }
  };

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
          // メンバー 0 件では作成手段が消えるため、黙って隠さず理由を案内する
          // （Issue #16、AppLayout.tsx と同方針）。members 読み込み中（undefined）は
          // 判定できないため何も出さない。
          members !== undefined && <NoMembersNotice />
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
        <button className="dangerOutline" onClick={requestDelete} type="button">
          Issue を削除
        </button>
        {confirmingDelete && (
          <ConfirmPanel
            busy={deletingNumber !== null}
            confirmLabel="削除する"
            error={deleteError}
            message="この Issue と配下の Task・Git 連携をすべて削除します。取り消せません。"
            onCancel={() => setConfirmingDelete(false)}
            onConfirm={() => void confirmDelete()}
          />
        )}
      </section>
    </main>
  );
}
