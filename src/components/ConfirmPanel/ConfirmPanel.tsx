import { useEffect, useRef } from "react";
import s from "./ConfirmPanel.module.css";

/**
 * 破壊的操作（削除・done/canceled への遷移）の確認パネル。
 * IssueDetail / TaskDetail の削除確認（useDeleteFlow 経由・エラー再試行の
 * ためパネルを開いたまま await し busy/error を表示する）と、TaskDetail の
 * 状態遷移確認（確定時に即パネルを閉じてから実行し、busy/error は渡さない）
 * の両方で共有する。busy 中は確定・キャンセルとも disabled にし、二重実行や
 * 取り消しを防ぐ。
 *
 * フォーカス管理（監査指摘）: マウント時にトリガー（表示前にフォーカスされて
 * いた要素）を記憶しパネル自体へフォーカスを移す。アンマウント時（確定・
 * キャンセルいずれの経路でも親が条件分岐を切ってこのコンポーネントを
 * 消す）にトリガーへ復帰させる。全呼び出し箇所で共通のため、呼び出し側の
 * 変更なしに全箇所へ適用される。
 */
export function ConfirmPanel({
  message,
  confirmLabel,
  confirmAriaLabel,
  onConfirm,
  onCancel,
  busy = false,
  error = null,
}: {
  message: string;
  confirmLabel: string;
  /**
   * 確認ボタンの accessible name をトリガー（同じ視覚ラベルを持ちうる）から
   * 区別したい場合に指定する（例: 対象名を含める）。省略時は confirmLabel の
   * まま（既存呼び出し箇所は指定不要で挙動不変）。
   */
  confirmAriaLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const trigger = document.activeElement;
    panelRef.current?.focus();
    return () => {
      if (trigger instanceof HTMLElement) {
        trigger.focus();
      }
    };
  }, []);

  return (
    <div className={s.panel} ref={panelRef} tabIndex={-1}>
      <p className={s.message}>{message}</p>
      <div className={s.actions}>
        <button
          aria-label={confirmAriaLabel}
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
