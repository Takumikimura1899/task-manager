import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { type FormEvent, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import s from "./AddTaskForm.module.css";

/**
 * 既存 Issue に Task を追加するインラインフォーム（tasks.create）。
 * Issue 行から開閉する。新規 Task は backlog の末尾に入る（Core 側で決定）。
 */
export function AddTaskForm({
  issue,
  createdBy,
}: {
  issue: Id<"issues">;
  createdBy: Id<"members">;
}) {
  const createTask = useMutation(api.tasks.create);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = title.trim() !== "" && !submitting;

  function close() {
    setOpen(false);
    setTitle("");
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await createTask({ issue, title: title.trim(), createdBy });
      close();
    } catch (err) {
      setError(
        err instanceof ConvexError ? String(err.data) : "追加に失敗しました",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button className={s.toggle} onClick={() => setOpen(true)} type="button">
        ＋ タスク
      </button>
    );
  }

  return (
    <form className={s.form} onSubmit={handleSubmit}>
      <input
        className={s.input}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="タスクのタイトル"
        value={title}
      />
      <button className={s.submit} disabled={!canSubmit} type="submit">
        追加
      </button>
      <button className={s.cancel} onClick={close} type="button">
        取消
      </button>
      {error !== null && <span className={s.error}>{error}</span>}
    </form>
  );
}
