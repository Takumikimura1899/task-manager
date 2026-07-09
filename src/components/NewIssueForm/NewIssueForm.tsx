import { useMutation } from "convex/react";
import { useId, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useCreateForm } from "../../hooks/useCreateForm";
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
  const errorId = useId();
  const [taskTitle, setTaskTitle] = useState("");
  const form = useCreateForm({
    onSubmit: async ({ title, priority, assignee }) => {
      await createIssue({
        project,
        title,
        createdBy,
        firstTask: {
          title: taskTitle.trim(),
          priority,
          assignee: assignee ?? undefined,
        },
      });
    },
    submitErrorMessage: "作成に失敗しました",
    extraValid: taskTitle.trim() !== "",
    onReset: () => setTaskTitle(""),
  });

  if (!form.open) {
    return (
      <div className={s.root}>
        <button
          className={s.toggle}
          onClick={() => form.setOpen(true)}
          type="button"
        >
          ＋ 新規 Issue
        </button>
      </div>
    );
  }

  return (
    <div className={s.root}>
      <form className={s.form} onSubmit={form.handleSubmit}>
        <input
          aria-describedby={form.error !== null ? errorId : undefined}
          aria-label="Issue のタイトル"
          className={s.input}
          onChange={(e) => form.setTitle(e.target.value)}
          placeholder="Issue のタイトル（解決すべき課題）"
          value={form.title}
        />
        <input
          aria-describedby={form.error !== null ? errorId : undefined}
          aria-label="最初のタスクのタイトル"
          className={s.input}
          onChange={(e) => setTaskTitle(e.target.value)}
          placeholder="最初のタスクのタイトル"
          value={taskTitle}
        />
        <TaskMetaFields
          assignee={form.assignee}
          onAssignee={form.setAssignee}
          onPriority={form.setPriority}
          priority={form.priority}
        />
        {form.error !== null && (
          <p className={s.error} id={errorId} role="alert">
            {form.error}
          </p>
        )}
        <div className={s.actions}>
          <button className={s.submit} disabled={!form.canSubmit} type="submit">
            作成
          </button>
          <button className={s.cancel} onClick={form.close} type="button">
            キャンセル
          </button>
        </div>
      </form>
    </div>
  );
}
