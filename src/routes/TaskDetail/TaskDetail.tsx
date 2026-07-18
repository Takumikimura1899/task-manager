import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  allowedTransitions,
  requiresApproval,
} from "../../../convex/lib/taskStatus";
import { Badge } from "../../components/Badge/Badge";
import { ConfirmPanel } from "../../components/ConfirmPanel/ConfirmPanel";
import { DetailEditForm } from "../../components/DetailEditForm/DetailEditForm";
import { DetailMeta } from "../../components/DetailMeta/DetailMeta";
import { GitLinkList } from "../../components/GitLinkList/GitLinkList";
import { Markdown } from "../../components/Markdown/Markdown";
import { TASK_TEMPLATES } from "../../components/MarkdownEditor/templates";
import { Skeleton } from "../../components/Skeleton/Skeleton";
import { useEditForm } from "../../hooks/useEditForm";
import { formatHours } from "../../lib/formatHours";
import { formatIssueRef } from "../../lib/formatIssueRef";
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
 * 空文字（空白のみ含む）は未設定への変更（null）、非空なら 0 以上の
 * 有限数のみ許容する。trim しないと空白のみが Number() で 0 になり、
 * 未設定のつもりが 0h として登録されてしまう。
 * 不正値は ConvexError として投げ、useEditForm の既存エラー表示（role=alert）に
 * 乗せて画面に伝える（サイレント失敗を避ける・送信もしない）。
 *
 * 前提: 呼び出し元が badInput（例: Firefox で type="number" に非数値文字を
 * 入力すると、テキストは見えたまま DOM の value だけが空文字になる状態）を
 * 事前にガードしていること。ここでは badInput の空文字と「本当に未入力」の
 * 空文字を区別できないため、区別を保つガードは呼び出し元の責務とする。
 */
function parseHoursDraft(label: string, raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) {
    throw new ConvexError(`${label}は 0 以上の数値で指定してください`);
  }
  return n;
}

/**
 * 破壊的操作（done/canceled への遷移・削除）の確認待ち状態（§6）。
 * 「実行内容のクロージャ」ではなく意図の宣言として持つ。run() クロージャに
 * 確定時点の task._id / revision を固定すると、パネル表示中に他クライアントが
 * 同タスクを更新した際 stale な expectedRevision を送ってしまう。確定処理
 * （runConfirmed）は kind/to から必要な値を導出し、実行時点の購読値
 * （task）から revision を読む（IssueTable の削除確認と同方式）。
 */
type PendingConfirm =
  | { kind: "transition"; to: TaskStatus }
  | { kind: "delete" };

export function TaskDetail() {
  const params = useParams();
  const projectKey = params.projectKey ?? "";
  const number = parseRefNumber(params.number);
  const navigate = useNavigate();
  // 表示中の number を常に最新化する ref。削除確定後の非同期継続処理
  // （confirmDeleteTask）が、実行中に client-side 遷移で表示先が切り替わって
  // いないかを判定するために使う（IssueDetail と対称・Issue #104 追加対応）。
  const numberRef = useRef(number);
  numberRef.current = number;

  const task = useQuery(
    api.tasks.getDetail,
    number !== null ? { projectKey, number } : "skip",
  );
  const members = useQuery(api.members.list);

  const updateFields = useMutation(api.tasks.updateFields);
  const transitionStatus = useMutation(api.tasks.transitionStatus);
  const assignTask = useMutation(api.tasks.assign);
  const deleteTask = useMutation(api.tasks.deleteTask);

  // badInput（例: Firefox で type="number" に「8h」等の非数値文字を入力すると、
  // テキストは表示されたまま DOM の value だけが空文字になる状態）を保存前に
  // 検知するための参照。実ブラウザ・現状の noValidate なしの構成では
  // ネイティブの constraint validation が先に submit をブロックするため
  // 通常はここに到達しないが、検証が効かない環境（jsdom 等のテスト）や
  // 将来 noValidate 化した場合に備える防御層として残す。value の空文字
  // だけでは「未入力」と区別できないため、input 自身の validity を見る
  // 必要がある（parseHoursDraft の docstring参照）。
  const estimateInputRef = useRef<HTMLInputElement | null>(null);
  const actualInputRef = useRef<HTMLInputElement | null>(null);

  // 保存時の expectedRevision は編集開始時点の revision（draft.revision）を
  // 送る（INVARIANT-2）。編集中に他者が更新していれば競合として検知される。
  const edit = useEditForm<TaskDraft>({
    save: async (draft) => {
      if (task === null || task === undefined) return;
      // badInput のまま parseHoursDraft に通すと空文字＝未設定と誤解釈され、
      // 既存の見積がサイレントにクリアされて保存されてしまうため先に弾く。
      if (estimateInputRef.current?.validity.badInput) {
        throw new ConvexError("予想工数は数値で入力してください");
      }
      if (actualInputRef.current?.validity.badInput) {
        throw new ConvexError("実績工数は数値で入力してください");
      }
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

  // 状態遷移・担当変更（フォーム外の即時操作）のエラー表示。
  // 競合時も useQuery が最新 revision へ自動更新するため、再操作すればよい。
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);

  // 破壊的操作（削除）専用の確認待ち状態。deletingNumber は「削除確定 =
  // busy」だけでなく削除対象の number も保持する。同一マウントのまま別の
  // Task へ client-side 遷移された場合に、別 Task の表示へ誤って波及させ
  // ないためのスコープに使う（IssueDetail と対称・Issue #104 追加対応）。
  const [deletingNumber, setDeletingNumber] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const notFound = (
    <main className={s.page}>
      <Link className={s.back} to="/">
        ← 一覧へ
      </Link>
      <p className="hint">Task が見つかりませんでした。</p>
      {/* 並行削除（他ユーザーが先に削除）と自分の削除失敗が重なった場合、
          task===null で notFound へ来てしまい ConfirmPanel 内のエラー表示に
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
      <Link className={s.back} to="/">
        ← 一覧へ
      </Link>
      <output aria-label="Task を読み込み中" className={s.loading}>
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

  if (task === undefined) {
    return loading;
  }

  if (task === null) {
    // 削除確定（confirmDeleteTask）後、navigate 到達までの間に getDetail の
    // 購読が read-your-writes で先に null を返すことがある。削除対象の
    // number と現在表示中の number が一致する場合のみローディングに留め、
    // 一致しなければ本当に見つからない（無効な参照・外部での削除等・
    // 削除 in-flight 中に別の Task へ遷移した後にその Task が存在しない
    // 場合）。
    return deletingNumber === number ? loading : notFound;
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
    // 破壊的遷移（done/canceled）は確認を挟む（§6 Human-in-the-Loop）。
    if (requiresApproval(to)) {
      setConfirm({ kind: "transition", to });
    } else {
      void runAction(async () => {
        await transitionStatus({
          id: task._id,
          to,
          expectedRevision: task.revision,
        });
      });
    }
  };

  const requestDelete = () => {
    setDeleteError(null);
    setConfirm({ kind: "delete" });
  };

  // 削除専用の確定処理。transition/assign と異なり (a) navigate を伴う、
  // (b) 削除対象の number スコープが必要なため、runAction 経由の
  // actionError ではなく専用の deletingNumber/deleteError で扱う
  // （IssueDetail.confirmDelete と対称・Issue #104 追加対応）。
  const confirmDeleteTask = async () => {
    if (deletingNumber !== null) return;
    setDeleteError(null);
    setDeletingNumber(number);
    const target = number;
    try {
      await deleteTask({ id: task._id, expectedRevision: task.revision });
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
    // （target）と一致する場合のみ遷移する。in-flight 中に別の Task へ
    // client-side 遷移されていた場合、無関係な画面を強制的に一覧へ飛ばす
    // のを防ぐ（Issue #104 追加対応）。一致しなければ deletingNumber だけ
    // 戻す（この target を表示中の画面へ戻ってきたとき、既に削除済みの
    // number に対して deletingNumber===number が成立し続けてローディング
    // 表示のまま固まるのを防ぐため）。
    if (numberRef.current === target) {
      navigate("/"); // 削除後は一覧へ戻る
    } else {
      setDeletingNumber(null);
    }
  };

  // 確定時点の購読値（task）の revision を expectedRevision に使う。編集
  // フォームが draft.revision（編集開始時点、Issue #73）を使うのとは対照的
  // ――確認パネルは開いてから確定までが短い即時操作なので、パネル表示中に
  // 他クライアントが更新していれば最新値を送るほうが自然に成功する
  // （IssueTable の削除確認と同方式）。
  const runConfirmed = () => {
    if (confirm === null) return;
    const pending = confirm;
    setConfirm(null);
    if (pending.kind === "delete") {
      void confirmDeleteTask();
      return;
    }
    void runAction(async () => {
      await transitionStatus({
        id: task._id,
        to: pending.to,
        expectedRevision: task.revision,
      });
    });
  };

  // 破壊的操作の確認パネル。操作した場所（遷移ボタン／削除ボタン）の直下に出す。
  // message/label は現行文言を維持したまま kind/to から都度導出する。削除は
  // 専用の busy/error（deletingNumber/deleteError）を渡し、遷移は既存どおり
  // busy/error なし（失敗時は actionError で別途表示）のまま扱う。
  const confirmPanel = confirm !== null && (
    <ConfirmPanel
      busy={confirm.kind === "delete" && deletingNumber !== null}
      confirmLabel={
        confirm.kind === "transition"
          ? `${TASK_STATUS_LABELS[confirm.to]}にする`
          : "削除する"
      }
      error={confirm.kind === "delete" ? deleteError : null}
      message={
        confirm.kind === "transition"
          ? `「${TASK_STATUS_LABELS[confirm.to]}」へ遷移します。この操作は取り消せません。`
          : "この Task を削除します。関連する Git 連携も併せて削除されます。取り消せません。"
      }
      onCancel={() => setConfirm(null)}
      onConfirm={runConfirmed}
    />
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
          {formatIssueRef(task.issueNumber)}
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
            formLabel="Task を編集"
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
                ref={estimateInputRef}
                step="any"
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
                ref={actualInputRef}
                step="any"
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
            {task.estimate === undefined ? "—" : formatHours(task.estimate)}
          </dd>
          <dt className={s.term}>実績工数</dt>
          <dd className={`${s.value} ${s.hours}`}>
            {task.actual === undefined ? "—" : formatHours(task.actual)}
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

      <section className="dangerSection">
        <h2 className={s.sectionTitle}>操作</h2>
        <button className="dangerOutline" onClick={requestDelete} type="button">
          Task を削除
        </button>
        <p className="hintSm">
          Issue の最後の Task は削除できません（Issue ごと削除してください）。
        </p>
        {confirm !== null && confirm.kind === "delete" && confirmPanel}
      </section>
    </main>
  );
}
