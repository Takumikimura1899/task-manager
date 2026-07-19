import { type FormEvent, useState } from "react";
import { convexErrorMessage } from "../lib/convexErrorMessage";

/**
 * 詳細画面（Issue / Task）共通の編集モード状態管理フック。
 * draft の有無が編集モード（draft === null は閲覧モード）を表す。
 *
 * 楽観ロック（INVARIANT-2）の競合は ConvexError のメッセージ
 * （convex/lib/revision.ts の「競合が発生しました…」）で検出し conflict とする。
 * useQuery が最新データへ自動更新するため、呼び出し側は「最新を読み込む」導線で
 * open(最新値) を呼び直せば編集をやり直せる。
 */
export function useEditForm<T>({
  save,
}: {
  save: (draft: T) => Promise<void>;
}) {
  const [draft, setDraft] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);

  function clearError() {
    setError(null);
    setConflict(false);
  }

  /** 指定値を初期値として編集モードへ入る（競合後の再読込にも使う）。 */
  function open(initial: T) {
    setDraft(initial);
    clearError();
  }

  /** 編集を破棄して閲覧モードへ戻る。 */
  function close() {
    setDraft(null);
    clearError();
  }

  /** draft の一部フィールドを更新する。 */
  function update(patch: Partial<T>) {
    setDraft((current) =>
      current === null ? current : { ...current, ...patch },
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (draft === null || saving) return;
    setSaving(true);
    clearError();
    try {
      await save(draft);
      close();
    } catch (err) {
      const message = convexErrorMessage(err, "保存に失敗しました");
      setError(message);
      setConflict(message.includes("競合"));
    } finally {
      setSaving(false);
    }
  }

  return {
    /** null なら閲覧モード。編集中はフォームの現在値。 */
    draft,
    editing: draft !== null,
    open,
    close,
    update,
    submit,
    error,
    conflict,
    saving,
  };
}
