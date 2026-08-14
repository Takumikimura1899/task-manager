import { useMutation, useQuery } from "convex/react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ProjectRole } from "../../../convex/lib/authz";
import { ConfirmPanel } from "../../components/ConfirmPanel/ConfirmPanel";
import { DetailPage } from "../../components/DetailPage/DetailPage";
import { Skeleton } from "../../components/Skeleton/Skeleton";
import { reportConvexError } from "../../lib/convexErrorMessage";
import { PROJECT_ROLE_LABELS } from "../../lib/projectRoleMeta";
import s from "./ProjectMembers.module.css";

const BACK_PATH = "/";

/** 除名・脱退の確認待ち状態（相互排他。TaskDetail の pendingTransition と同型）。 */
type PendingAction =
  | { type: "remove"; member: Id<"members">; name: string }
  | { type: "leave" };

/**
 * プロジェクトのメンバー管理画面（ADR-11 §7）。
 *
 * - owner: メンバーの追加・ロール変更・除名ができる。自分自身の行だけは
 *   「脱退する」のみを出す（自分の除名・降格は出さない）。
 * - member: 一覧の閲覧と自分の脱退のみ（操作列は出さない）。
 *
 * 最後の owner への降格・除名・脱退はサーバー（INVARIANT-6）が ConvexError
 * で拒否する。握り潰さず ConfirmPanel / actionError にそのまま表示する
 * （CLAUDE.md「サイレント失敗の回避」）。
 */
export function ProjectMembers() {
  const params = useParams();
  const projectKey = params.projectKey ?? "";
  const navigate = useNavigate();

  const project = useQuery(api.projects.getByKey, { key: projectKey });
  const memberships = useQuery(
    api.projectMembers.listByProject,
    project !== null && project !== undefined
      ? { project: project._id }
      : "skip",
  );
  const me = useQuery(api.members.me);
  // 追加フォームを開いている間だけ全社名簿を購読する（監査指摘: 常時購読）。
  const [addOpen, setAddOpen] = useState(false);
  const allMembers = useQuery(api.members.list, addOpen ? {} : "skip");

  const addMemberMutation = useMutation(api.projectMembers.add);
  const changeRoleMutation = useMutation(api.projectMembers.changeRole);
  const removeMutation = useMutation(api.projectMembers.remove);
  const leaveMutation = useMutation(api.projectMembers.leave);

  const [roleError, setRoleError] = useState<{
    member: Id<"members">;
    message: string;
  } | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [pendingBusy, setPendingBusy] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);

  const [addMemberId, setAddMemberId] = useState<Id<"members"> | null>(null);
  const [addRole, setAddRole] = useState<ProjectRole>("member");
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const roleErrorId = useId();
  const addToggleRef = useRef<HTMLButtonElement | null>(null);
  const addMemberSelectRef = useRef<HTMLSelectElement | null>(null);
  const wasAddOpenRef = useRef(false);

  // memberships/allMembers はここではまだガード（後段の early return）を
  // 通っていないため "?? []" の安全側フォールバックを使う。追加トグル
  // フォーカス管理・stale 判定のどちらもガード前のフックから参照するため、
  // candidateMembers はガード前に1箇所だけで計算する（後段で再計算しない）。
  const candidateMembers = (allMembers ?? []).filter(
    (m) => !(memberships ?? []).some((row) => row.member._id === m._id),
  );
  const addFormReady = addOpen && allMembers !== undefined;

  // 追加フォームを開いたら候補読み込み後に最初の select へフォーカスする
  // （監査指摘: トグルの unmount で focus が body に落ちる）。
  useEffect(() => {
    if (addFormReady) {
      addMemberSelectRef.current?.focus();
    }
  }, [addFormReady]);

  // 追加フォームを閉じた（キャンセル／追加成功のいずれか）ときはトグルへ
  // フォーカスを戻す。初回マウント時（addOpen が最初から false）には発火
  // しないよう、直前が open だったかを wasAddOpenRef で判定する。
  useEffect(() => {
    if (!addOpen && wasAddOpenRef.current) {
      addToggleRef.current?.focus();
    }
    wasAddOpenRef.current = addOpen;
  }, [addOpen]);

  // 選択中の候補が表示中に外れた（別 owner が先に追加した等）場合、
  // stale な選択を残さずリセットする（監査指摘: addMemberId の stale 化）。
  useEffect(() => {
    if (
      addMemberId !== null &&
      !candidateMembers.some((m) => m._id === addMemberId)
    ) {
      setAddMemberId(null);
    }
  }, [addMemberId, candidateMembers]);

  if (project === undefined || memberships === undefined || me === undefined) {
    return (
      <DetailPage backTo={BACK_PATH}>
        <output aria-label="メンバーを読み込み中" className={s.loading}>
          <Skeleton className={s.skeletonHeading} />
          <Skeleton className={s.skeletonSection} />
        </output>
      </DetailPage>
    );
  }

  if (project === null || memberships === null) {
    // memberships が null になるのは resolveProject が project を解決できない
    // 場合（projectQuery の型契約）。project が非 null で listByProject を
    // 呼ぶのは project 解決成功後のみのため実運用では到達しないが、型上
    // 到達しうる分岐を握り潰さず同じ「見つかりませんでした」に倒す。
    return (
      <DetailPage backTo={BACK_PATH}>
        <p className="hint">プロジェクトが見つかりませんでした。</p>
      </DetailPage>
    );
  }

  const myMembership =
    me === null
      ? undefined
      : memberships.find((row) => row.member._id === me._id);
  const isOwner = myMembership?.role === "owner";

  const closeAddForm = () => {
    setAddOpen(false);
    setAddMemberId(null);
    setAddRole("member");
    setAddError(null);
  };

  const handleAddSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (addMemberId === null) return;
    setAddSubmitting(true);
    setAddError(null);
    try {
      await addMemberMutation({
        project: project._id,
        member: addMemberId,
        role: addRole,
      });
      closeAddForm();
    } catch (err) {
      setAddError(reportConvexError(err, "追加に失敗しました"));
    } finally {
      setAddSubmitting(false);
    }
  };

  const handleRoleChange = async (
    member: Id<"members">,
    name: string,
    role: ProjectRole,
  ) => {
    setRoleError(null);
    try {
      await changeRoleMutation({ project: project._id, member, role });
    } catch (err) {
      setRoleError({
        member,
        message: `「${name}」のロール変更に失敗しました: ${reportConvexError(
          err,
          "ロール変更に失敗しました",
        )}`,
      });
    }
  };

  const requestRemove = (member: Id<"members">, name: string) => {
    setPendingError(null);
    setPending({ type: "remove", member, name });
  };
  const requestLeave = () => {
    setPendingError(null);
    setPending({ type: "leave" });
  };
  const cancelPending = () => {
    setPending(null);
    setPendingError(null);
  };
  const confirmPending = async () => {
    if (pending === null || pendingBusy) return;
    setPendingBusy(true);
    setPendingError(null);
    try {
      if (pending.type === "remove") {
        await removeMutation({ project: project._id, member: pending.member });
        setPending(null);
      } else {
        await leaveMutation({ project: project._id });
        // 脱退後はこのプロジェクトの query が非参加拒否になるため、
        // 画面ごと Task 一覧へ戻す（IssueDetail/TaskDetail の削除後 navigate
        // と同じ考え方）。
        navigate(BACK_PATH);
        return;
      }
    } catch (err) {
      setPendingError(
        reportConvexError(
          err,
          pending.type === "remove"
            ? "除名に失敗しました"
            : "脱退に失敗しました",
        ),
      );
    } finally {
      setPendingBusy(false);
    }
  };

  return (
    <DetailPage backTo={BACK_PATH}>
      <header className={s.header}>
        <h1 className={s.title}>メンバー</h1>
        <p className={s.subtitle}>
          {project.key} — {project.name}
        </p>
      </header>

      <section className={s.section}>
        <div className={s.sectionHeader}>
          <h2 className={s.sectionTitle}>
            メンバー一覧（{memberships.length}）
          </h2>
          {isOwner && !addOpen && (
            <button
              className={s.addToggle}
              onClick={() => setAddOpen(true)}
              ref={addToggleRef}
              type="button"
            >
              ＋ メンバーを追加
            </button>
          )}
        </div>

        {isOwner && addOpen && (
          <form className={s.addForm} onSubmit={handleAddSubmit}>
            {allMembers === undefined ? (
              <output aria-label="候補を読み込み中" className="hintSm">
                候補を読み込み中…
              </output>
            ) : (
              <>
                <label className={s.addField}>
                  メンバー
                  <select
                    className={s.select}
                    onChange={(e) =>
                      setAddMemberId(
                        e.target.value === ""
                          ? null
                          : (e.target.value as Id<"members">),
                      )
                    }
                    ref={addMemberSelectRef}
                    value={addMemberId ?? ""}
                  >
                    <option value="">選択してください</option>
                    {candidateMembers.map((m) => (
                      <option key={m._id} value={m._id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={s.addField}>
                  ロール
                  <select
                    className={s.select}
                    onChange={(e) => setAddRole(e.target.value as ProjectRole)}
                    value={addRole}
                  >
                    <option value="member">{PROJECT_ROLE_LABELS.member}</option>
                    <option value="owner">{PROJECT_ROLE_LABELS.owner}</option>
                  </select>
                </label>
              </>
            )}
            <div className={s.addActions}>
              <button
                className={s.submit}
                disabled={
                  addMemberId === null ||
                  addSubmitting ||
                  allMembers === undefined
                }
                type="submit"
              >
                追加
              </button>
              <button className={s.cancel} onClick={closeAddForm} type="button">
                キャンセル
              </button>
            </div>
            {addError !== null && (
              <p className="actionError" role="alert">
                {addError}
              </p>
            )}
          </form>
        )}

        {memberships.length === 0 ? (
          <p className={s.empty}>メンバーがいません。</p>
        ) : (
          <div className={s.wrapper}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th className={s.th} scope="col">
                    名前
                  </th>
                  <th className={s.th} scope="col">
                    ロール
                  </th>
                  {isOwner && (
                    <th className={s.th} scope="col">
                      操作
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {memberships.map((row) => {
                  const isMe = me !== null && row.member._id === me._id;
                  const hasRoleError =
                    roleError !== null && roleError.member === row.member._id;
                  return (
                    <tr key={row._id}>
                      <td className={s.td}>{row.member.name}</td>
                      <td className={s.td}>
                        <span
                          className={`${s.roleBadge} ${
                            row.role === "owner" ? s.owner : s.member
                          }`}
                        >
                          {PROJECT_ROLE_LABELS[row.role]}
                        </span>
                      </td>
                      {isOwner && (
                        <td className={s.td}>
                          {isMe ? (
                            <button
                              className="dangerOutline"
                              onClick={requestLeave}
                              type="button"
                            >
                              脱退する
                            </button>
                          ) : (
                            <div className={s.rowActions}>
                              <select
                                aria-describedby={
                                  hasRoleError ? roleErrorId : undefined
                                }
                                aria-invalid={hasRoleError ? true : undefined}
                                aria-label={`${row.member.name} のロール`}
                                className={s.select}
                                onChange={(e) =>
                                  void handleRoleChange(
                                    row.member._id,
                                    row.member.name,
                                    e.target.value as ProjectRole,
                                  )
                                }
                                value={row.role}
                              >
                                <option value="member">
                                  {PROJECT_ROLE_LABELS.member}
                                </option>
                                <option value="owner">
                                  {PROJECT_ROLE_LABELS.owner}
                                </option>
                              </select>
                              <button
                                className="dangerOutline"
                                onClick={() =>
                                  requestRemove(row.member._id, row.member.name)
                                }
                                type="button"
                              >
                                除名する
                              </button>
                            </div>
                          )}
                          {roleError !== null &&
                            roleError.member === row.member._id && (
                              <p
                                className="actionError"
                                id={roleErrorId}
                                role="alert"
                              >
                                {roleError.message}
                              </p>
                            )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {!isOwner && (
        <section className="dangerSection">
          <h2 className={s.sectionTitle}>操作</h2>
          <button
            className="dangerOutline"
            onClick={requestLeave}
            type="button"
          >
            脱退する
          </button>
        </section>
      )}

      {pending !== null && (
        <ConfirmPanel
          busy={pendingBusy}
          confirmAriaLabel={
            pending.type === "remove"
              ? `「${pending.name}」を除名する`
              : "このプロジェクトから脱退する"
          }
          confirmLabel={pending.type === "remove" ? "除名する" : "脱退する"}
          error={pendingError}
          message={
            pending.type === "remove"
              ? `「${pending.name}」をこのプロジェクトから除名します。取り消せません。`
              : "このプロジェクトから脱退します。取り消せません。"
          }
          onCancel={cancelPending}
          onConfirm={() => void confirmPending()}
        />
      )}
    </DetailPage>
  );
}
