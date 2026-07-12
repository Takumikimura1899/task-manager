import { lazy, Suspense, type FormEvent, type ReactNode } from "react";
import type { MarkdownTemplate } from "../MarkdownEditor/templates";
import s from "./DetailEditForm.module.css";

// Markdown エディタはバンドルが重いため、編集モードに入ったときだけ読み込む。
const MarkdownEditor = lazy(() =>
  import("../MarkdownEditor/MarkdownEditor").then((m) => ({
    default: m.MarkdownEditor,
  })),
);

/**
 * 詳細画面（Issue / Task）共通のタイトル・説明編集フォーム。
 * 状態は useEditForm（呼び出し側）が持ち、本コンポーネントは表示に徹する。
 * 追加フィールド（Task の優先度など）は children として説明の下に差し込む。
 * 説明は Markdown エディタ（ツールバー・プレビュー・テンプレート挿入付き）で編集する。
 *
 * 楽観ロック競合時（conflict）は role="alert" のエラーに加えて
 * 「最新の内容を読み込んで編集し直す」導線を表示する。useQuery が最新へ
 * 自動更新するため、onReload では最新値をフォームへ反映し直すだけでよい。
 */
export function DetailEditForm({
  formLabel,
  title,
  description,
  onTitle,
  onDescription,
  onSubmit,
  onCancel,
  error,
  conflict,
  onReload,
  saving,
  templates,
  children,
}: {
  formLabel: string;
  title: string;
  description: string;
  onTitle: (value: string) => void;
  onDescription: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
  error: string | null;
  conflict: boolean;
  onReload: () => void;
  saving: boolean;
  templates: MarkdownTemplate[];
  children?: ReactNode;
}) {
  return (
    <form aria-label={formLabel} className={s.form} onSubmit={onSubmit}>
      <label className={s.field}>
        タイトル
        <input
          className={s.input}
          onChange={(e) => onTitle(e.target.value)}
          value={title}
        />
      </label>
      <div className={s.field}>
        <span>説明</span>
        <Suspense
          fallback={
            <textarea
              aria-label="説明"
              className={s.textarea}
              readOnly
              rows={8}
              value={description}
            />
          }
        >
          <MarkdownEditor
            ariaLabel="説明"
            onChange={onDescription}
            templates={templates}
            value={description}
          />
        </Suspense>
      </div>
      {children}
      {error !== null && (
        <div className={s.errorRow}>
          <p className={s.error} role="alert">
            {error}
          </p>
          {conflict && (
            <button className={s.reload} onClick={onReload} type="button">
              最新の内容を読み込んで編集し直す
            </button>
          )}
        </div>
      )}
      <div className={s.actions}>
        <button
          className={s.save}
          disabled={title.trim() === "" || saving}
          type="submit"
        >
          保存
        </button>
        <button className={s.cancel} onClick={onCancel} type="button">
          キャンセル
        </button>
      </div>
    </form>
  );
}
