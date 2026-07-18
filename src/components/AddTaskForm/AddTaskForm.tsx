import { useMutation } from "convex/react";
import { useId } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useCreateForm } from "../../hooks/useCreateForm";
import { TaskMetaFields } from "../forms/TaskMetaFields";
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
  const errorId = useId();
  const form = useCreateForm({
    onSubmit: async ({ title, priority, assignee }) => {
      await createTask({
        issue,
        title,
        priority,
        assignee: assignee ?? undefined,
        createdBy,
      });
    },
    submitErrorMessage: "作成に失敗しました",
  });

  if (!form.open) {
    return (
      <button
        className={s.toggle}
        onClick={() => form.setOpen(true)}
        type="button"
      >
        ＋ Task を作成
      </button>
    );
  }

  return (
    <form className={s.form} onSubmit={form.handleSubmit}>
      <input
        aria-describedby={form.error !== null ? errorId : undefined}
        aria-label="Task のタイトル"
        className={s.input}
        onChange={(e) => form.setTitle(e.target.value)}
        placeholder="Task のタイトル"
        value={form.title}
      />
      <TaskMetaFields
        assignee={form.assignee}
        onAssignee={form.setAssignee}
        onPriority={form.setPriority}
        priority={form.priority}
      />
      <button className={s.submit} disabled={!form.canSubmit} type="submit">
        作成
      </button>
      <button className={s.cancel} onClick={form.close} type="button">
        キャンセル
      </button>
      {form.error !== null && (
        <span className={s.error} id={errorId} role="alert">
          {form.error}
        </span>
      )}
    </form>
  );
}
