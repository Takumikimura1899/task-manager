import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { type FormEvent, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { type Priority } from "../../lib/taskMeta";
import { TaskMetaFields } from "../forms/TaskMetaFields";
import s from "./NewIssueForm.module.css";

/**
 * Issue 作成フォーム。Issue は最初の Task を必ず伴う（INVARIANT-5）ため、
 * Issue タイトルと最初の Task タイトルを同時に受け取り issues.create を呼ぶ。
 */
export function NewIssueForm({
  project,
  createdBy,
}: {
  project: Id<"projects">;
  createdBy: Id<"members">;
}) {
  const createIssue = useMutation(api.issues.create);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("none");
  const [assignee, setAssignee] = useState<Id<"members"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit =
    title.trim() !== "" && taskTitle.trim() !== "" && !submitting;

  function close() {
    setOpen(false);
    setTitle("");
    setTaskTitle("");
    setPriority("none");
    setAssignee(null);
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await createIssue({
        project,
        title: title.trim(),
        createdBy,
        firstTask: {
          title: taskTitle.trim(),
          priority,
          assignee: assignee ?? undefined,
        },
      });
      close();
    } catch (err) {
      setError(
        err instanceof ConvexError ? String(err.data) : "作成に失敗しました",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <div className={s.root}>
        <button
          className={s.toggle}
          onClick={() => setOpen(true)}
          type="button"
        >
          ＋ 新規 Issue
        </button>
      </div>
    );
  }

  return (
    <div className={s.root}>
      <form className={s.form} onSubmit={handleSubmit}>
        <input
          className={s.input}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Issue のタイトル（解決すべき課題）"
          value={title}
        />
        <input
          className={s.input}
          onChange={(e) => setTaskTitle(e.target.value)}
          placeholder="最初のタスクのタイトル"
          value={taskTitle}
        />
        <TaskMetaFields
          assignee={assignee}
          onAssignee={setAssignee}
          onPriority={setPriority}
          priority={priority}
        />
        {error !== null && <p className={s.error}>{error}</p>}
        <div className={s.actions}>
          <button className={s.submit} disabled={!canSubmit} type="submit">
            作成
          </button>
          <button className={s.cancel} onClick={close} type="button">
            キャンセル
          </button>
        </div>
      </form>
    </div>
  );
}
