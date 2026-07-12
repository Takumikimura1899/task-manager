import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  allowedTransitions,
  requiresApproval,
} from "../../../convex/lib/taskStatus";
import { Badge } from "../../components/Badge/Badge";
import { DetailEditForm } from "../../components/DetailEditForm/DetailEditForm";
import { DetailMeta } from "../../components/DetailMeta/DetailMeta";
import { GitLinkList } from "../../components/GitLinkList/GitLinkList";
import { Markdown } from "../../components/Markdown/Markdown";
import { TASK_TEMPLATES } from "../../components/MarkdownEditor/templates";
import { Skeleton } from "../../components/Skeleton/Skeleton";
import { useEditForm } from "../../hooks/useEditForm";
import { parseRefNumber } from "../../lib/routeParams";
import {
  PRIORITY_LABELS,
  PRIORITY_OPTIONS,
  type Priority,
  TASK_STATUS_LABELS,
  type TaskStatus,
} from "../../lib/taskMeta";
import s from "./TaskDetail.module.css";

/**
 * 編集フォームの下書き（タイトル・説明・優先度・予想/実績工数）。
 * revision は編集開始時点の値を保持し、保存時の expectedRevision に使う。
 * 購読中の最新値を使うと、編集中の他者更新で expectedRevision も追従して
 * しまい競合を検知できないため（Issue #73）。
 * estimate / actual は input の値を文字列で保持する（空文字 = 未設定）。
 */
type TaskDraft = {
  title: string;
  description: string;
  priority: Priority;
  estimate: string;
  actual: string;
  revision: number;
};

/**
 * 工数 input の文字列値を送信用の値へ変換する。
 * 空文字は未設定への変更（null）、非空なら 0 以上の有限数のみ許容する。
 * 不正値は ConvexError として投げ、useEditForm の既存エラー表示（role=alert）に
 * 乗せて画面に伝える（サイレント失敗を避ける・送信もしない）。
 */
function parseHoursDraft(label: string, raw: string): number | null {
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new ConvexError(`${label}は 0 以上の数値で指定してください`);
  }
  return n;
}

/** 破壊的操作（done/canceled への遷移・削除）の確認待ち状態（§6）。 */
type PendingConfirm = {
  /** 確認パネルの表示位置（操作した場所の直下に出す）。 */
  kind: "transition" | "delete";
  message: string;
  label: string;
  run: () => Promise<void>;
};

export function TaskDetail() {
  const params = useParams();
  const projectKey = params.projectKey ?? "";
  const number = parseRefNumber(params.number);
  const navigate = useNavigate();

  const task = useQuery(
    api.tasks.getDetail,
    number !== null ? { projectKey, number } : "skip",
  );
  const members = useQuery(api.members.list);

  const updateFields = useMutation(api.tasks.updateFields);
  const transitionStatus = useMutation(api.tasks.transitionStatus);
  const assignTask = useMutation(api.tasks.assign);
  const deleteTask = useMutation(api.tasks.deleteTask);

  // 保存時の expectedRevision は編集開始時点の revision（draft.revision）を
  // 送る（INVARIANT-2）。編集中に他者が更新していれば競合として検知される。
  const edit = useEditForm<TaskDraft>({
    save: async (draft) => {
      if (task === null || task === undefined) return;
      const estimate = parseHoursDraft("予想工数", draft.estimate);
      const actual = parseHoursDraft("実績工数", draft.actual);
      await updateFields({
        id: task._id,
        expectedRevision: draft.revision,
        title: draft.title.trim(),
        description: draft.description,
        priority: draft.priority,
        estimate,
        actual,
      });
    },
  });

  // 状態遷移・担当変更・削除（フォーム外の即時操作）のエラー表示。
  // 競合時も useQuery が最新 revision へ自動更新するため、再操作すればよい。
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);

  if (number === null || task === null) {
    return (
      <main className={s.page}>
        <Link className={s.back} to="/">
          ← 一覧へ
        </Link>
        <p className="hint">タスクが見つかりませんでした。</p>
      </main>
    );
  }

  // 読み込み中もページ枠と戻り導線を維持し、見出し・本文セクションの
  // 矩形をスケルトンで示す（Issue #29：全画面差し替えをやめる）。
  if (task === undefined) {
    return (
      <main className={s.page}>
        <Link className={s.back} to="/">
          ← 一覧へ
        </Link>
        <output aria-label="タスクを読み込み中" className={s.loading}>
          <Skeleton className={s.skeletonHeading} />
          <Skeleton className={s.skeletonTitle} />
          <Skeleton className={s.skeletonSection} />
          <Skeleton className={s.skeletonSection} />
        </output>
      </main>
    );
  }

  // 編集の初期値・競合後の再読込は常に最新の購読値から作る。
  const toDraft = (): TaskDraft => ({
    title: task.title,
    description: task.description ?? "",
    priority: task.priority,
    estimate: task.estimate?.toString() ?? "",
    actual: task.actual?.toString() ?? "",
    revision: task.revision,
  });

  const runAction = async (action: () => Promise<void>) => {
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(
        err instanceof ConvexError ? String(err.data) : "操作に失敗しました",
      );
    }
  };

  const requestTransition = (to: TaskStatus) => {
    const run = async () => {
      await transitionStatus({
        id: task._id,
        to,
        expectedRevision: task.revision,
      });
    };
    // 破壊的遷移（done/canceled）は確認を挟む（§6 Human-in-the-Loop）。
    if (requiresApproval(to)) {
      setConfirm({
        kind: "transition",
        message: `「${TASK_STATUS_LABELS[to]}」へ遷移します。この操作は取り消せません。`,
        label: `${TASK_STATUS_LABELS[to]}にする`,
        run,
      });
    } else {
      void runAction(run);
    }
  };

  const requestDelete = () => {
    setConfirm({
      kind: "delete",
      message:
        "このタスクを削除しますか？関連する Git 連携も併せて削除されます。",
      label: "削除する",
      run: async () => {
        await deleteTask({ id: task._id, expectedRevision: task.revision });
        navigate("/"); // 削除後は一覧へ戻る
      },
    });
  };

  const runConfirmed = () => {
    if (confirm === null) return;
    const { run } = confirm;
    setConfirm(null);
    void runAction(run);
  };

  // 破壊的操作の確認パネル。操作した場所（遷移ボタン／削除ボタン）の直下に出す。
  const confirmPanel = confirm !== null && (
    <div className={s.confirmPanel}>
      <p className={s.confirmMessage}>{confirm.message}</p>
      <div className={s.confirmActions}>
        <button className={s.danger} onClick={runConfirmed} type="button">
          {confirm.label}
        </button>
        <button
          className={s.cancel}
          onClick={() => setConfirm(null)}
          type="button"
        >
          キャンセル
        </button>
      </div>
    </div>
  );

  return (
    <main className={s.page}>
      <Link className={s.back} to="/">
        ← 一覧へ
      </Link>

      {task.issueNumber !== null && (
        <Link
          className={s.breadcrumb}
          to={`/${task.projectKey}/issues/${task.issueNumber}`}
        >
          {task.projectKey}#{task.issueNumber}
          {task.issueTitle !== null && ` ${task.issueTitle}`}
        </Link>
      )}

      <header className={s.header}>
        <div className={s.heading}>
          <span className={s.ref}>
            {task.projectKey}-{task.number}
          </span>
          <Badge status={task.status}>{TASK_STATUS_LABELS[task.status]}</Badge>
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
        {!edit.editing && <h1 className={s.title}>{task.title}</h1>}
      </header>

      {edit.editing && edit.draft !== null ? (
        <section className={s.section}>
          <DetailEditForm
            conflict={edit.conflict}
            description={edit.draft.description}
            error={edit.error}
            formLabel="タスクを編集"
            onCancel={edit.close}
            onDescription={(description) => edit.update({ description })}
            onReload={() => edit.open(toDraft())}
            onSubmit={edit.submit}
            onTitle={(title) => edit.update({ title })}
            saving={edit.saving}
            templates={TASK_TEMPLATES}
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
            <label className={s.editField}>
              予想工数 (h)
              <input
                className={s.editInput}
                min="0"
                onChange={(e) => edit.update({ estimate: e.target.value })}
                step="0.5"
                type="number"
                value={edit.draft.estimate}
              />
            </label>
            <label className={s.editField}>
              実績工数 (h)
              <input
                className={s.editInput}
                min="0"
                onChange={(e) => edit.update({ actual: e.target.value })}
                step="0.5"
                type="number"
                value={edit.draft.actual}
              />
            </label>
          </DetailEditForm>
        </section>
      ) : (
        task.description !== undefined &&
        task.description !== "" && (
          <section className={s.section}>
            <Markdown>{task.description}</Markdown>
          </section>
        )
      )}

      <section className={s.section}>
        <dl className={s.props}>
          <dt className={s.term}>ステータス</dt>
          <dd className={s.value}>
            <div className={s.statusRow}>
              {TASK_STATUS_LABELS[task.status]}
              {allowedTransitions(task.status).map((to) => (
                <button
                  className={s.transition}
                  key={to}
                  onClick={() => requestTransition(to)}
                  type="button"
                >
                  → {TASK_STATUS_LABELS[to]}
                </button>
              ))}
            </div>
          </dd>
          <dt className={s.term}>優先度</dt>
          <dd className={s.value}>{PRIORITY_LABELS[task.priority]}</dd>
          <dt className={s.term}>担当者</dt>
          <dd className={s.value}>
            <select
              aria-label="担当者"
              className={s.assigneeSelect}
              onChange={(e) =>
                void runAction(async () => {
                  await assignTask({
                    id: task._id,
                    assignee:
                      e.target.value === ""
                        ? null
                        : (e.target.value as Id<"members">),
                    expectedRevision: task.revision,
                  });
                })
              }
              value={task.assignee ?? ""}
            >
              <option value="">未割り当て</option>
              {members?.map((m) => (
                <option key={m._id} value={m._id}>
                  {m.name}
                </option>
              ))}
            </select>
          </dd>
          <dt className={s.term}>予想工数</dt>
          <dd className={`${s.value} ${s.hours}`}>
            {task.estimate === undefined ? "—" : `${task.estimate}h`}
          </dd>
          <dt className={s.term}>実績工数</dt>
          <dd className={`${s.value} ${s.hours}`}>
            {task.actual === undefined ? "—" : `${task.actual}h`}
          </dd>
        </dl>
        {actionError !== null && (
          <p className={s.actionError} role="alert">
            {actionError}
          </p>
        )}
      </section>

      {confirm !== null && confirm.kind === "transition" && confirmPanel}

      <section className={s.section}>
        <h2 className={s.sectionTitle}>Git 連携</h2>
        <GitLinkList links={task.gitLinks} />
      </section>

      <section className={s.section}>
        <DetailMeta
          createdAt={task._creationTime}
          createdByName={task.createdByName}
          updatedAt={task.updatedAt}
        />
      </section>

      <section className={s.dangerSection}>
        <h2 className={s.sectionTitle}>操作</h2>
        <button
          className={s.dangerOutline}
          onClick={requestDelete}
          type="button"
        >
          タスクを削除
        </button>
        <p className={s.dangerHint}>
          Issue の最後のタスクは削除できません（Issue ごと削除してください）。
        </p>
        {confirm !== null && confirm.kind === "delete" && confirmPanel}
      </section>
    </main>
  );
}
