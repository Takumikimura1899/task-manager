import s from "./ConfirmPanel.module.css";

/**
 * 破壊的操作（削除・done/canceled への遷移）の確認パネル。
 * IssueDetail / TaskDetail の削除確認（useDeleteFlow 経由・エラー再試行の
 * ためパネルを開いたまま await し busy/error を表示する）と、TaskDetail の
 * 状態遷移確認（確定時に即パネルを閉じてから実行し、busy/error は渡さない）
 * の両方で共有する。busy 中は確定・キャンセルとも disabled にし、二重実行や
 * 取り消しを防ぐ。
 */
export function ConfirmPanel({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  busy = false,
  error = null,
}: {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  return (
    <div className={s.panel}>
      <p className={s.message}>{message}</p>
      <div className={s.actions}>
        <button
          className={s.danger}
          disabled={busy}
          onClick={onConfirm}
          type="button"
        >
          {confirmLabel}
        </button>
        <button
          className={s.cancel}
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          キャンセル
        </button>
      </div>
      {error !== null && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
