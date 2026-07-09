import { ConvexError } from "convex/values";
import { type FormEvent, useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import type { Priority } from "../lib/taskMeta";

/** 送信時に確定した入力値。title は trim 済み。 */
export type CreateFormValues = {
  title: string;
  priority: Priority;
  assignee: Id<"members"> | null;
};

/**
 * 作成フォーム（NewIssueForm / AddTaskForm）共通の状態管理フック。
 * 開閉・タイトル・優先度・担当者・エラー・送信中の各状態と、
 * 送信（成功時はクローズ＆リセット、ConvexError はメッセージ表示）を提供する。
 *
 * - `extraValid`: タイトル以外の追加バリデーション（例: NewIssueForm の
 *   最初のタスクタイトル）。false の間は送信できない。
 * - `onReset`: フック外で管理する追加フィールドのリセット処理。
 *   クローズ時（成功時含む）に呼ばれる。
 */
export function useCreateForm({
  onSubmit,
  submitErrorMessage,
  extraValid = true,
  onReset,
}: {
  onSubmit: (values: CreateFormValues) => Promise<void>;
  submitErrorMessage: string;
  extraValid?: boolean;
  onReset?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("none");
  const [assignee, setAssignee] = useState<Id<"members"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = title.trim() !== "" && extraValid && !submitting;

  function close() {
    setOpen(false);
    setTitle("");
    setPriority("none");
    setAssignee(null);
    setError(null);
    onReset?.();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ title: title.trim(), priority, assignee });
      close();
    } catch (err) {
      setError(
        err instanceof ConvexError ? String(err.data) : submitErrorMessage,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return {
    open,
    setOpen,
    title,
    setTitle,
    priority,
    setPriority,
    assignee,
    setAssignee,
    error,
    submitting,
    canSubmit,
    close,
    handleSubmit,
  };
}
