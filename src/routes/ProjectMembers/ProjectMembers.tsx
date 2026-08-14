import { useMutation, useQuery } from "convex/react";
import { type FormEvent, useState } from "react";
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
  const allMembers = useQuery(api.members.list, {});

  const addMemberMutation = useMutation(api.projectMembers.add);
  const changeRoleMutation = useMutation(api.projectMembers.changeRole);
  const removeMutation = useMutation(api.projectMembers.remove);
  const leaveMutation = useMutation(api.projectMembers.leave);

  const [roleError, setRoleError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [pendingBusy, setPendingBusy] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addMemberId, setAddMemberId] = useState<Id<"members"> | null>(null);
  const [addRole, setAddRole] = useState<ProjectRole>("member");
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

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

  const candidateMembers = (allMembers ?? []).filter(
    (m) => !memberships.some((row) => row.member._id === m._id),
  );

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

  const handleRoleChange = async (member: Id<"members">, role: ProjectRole) => {
    setRoleError(null);
    try {
      await changeRoleMutation({ project: project._id, member, role });
    } catch (err) {
      setRoleError(reportConvexError(err, "ロール変更に失敗しました"));
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
              type="button"
            >
              ＋ メンバーを追加
            </button>
          )}
        </div>

        {isOwner && addOpen && (
          <form className={s.addForm} onSubmit={handleAddSubmit}>
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
            <div className={s.addActions}>
              <button
                className={s.submit}
                disabled={addMemberId === null || addSubmitting}
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
                                aria-label={`${row.member.name} のロール`}
                                className={s.select}
                                onChange={(e) =>
                                  void handleRoleChange(
                                    row.member._id,
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
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {roleError !== null && (
          <p className="actionError" role="alert">
            {roleError}
          </p>
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
