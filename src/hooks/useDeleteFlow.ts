import { ConvexError } from "convex/values";
import { useEffect, useRef, useState } from "react";

/**
 * 詳細画面（Issue / Task）共通の削除確認フロー状態管理フック。
 * 確認パネルは開いたまま await する（確定前に閉じると busy/error の唯一の
 * 表示先である ConfirmPanel が即アンマウントされ、失敗がサイレントになる）。
 * remove 成功時は、表示中の number が削除確定時点の number と一致する場合のみ
 * onDeleted を呼ぶ（in-flight 中の client-side 遷移で無関係な画面を強制遷移させない）。
 * number が変わったら確認パネル開閉とエラーをリセットする。
 */
export function useDeleteFlow({
  number,
  remove,
  onDeleted,
}: {
  number: number | null;
  remove: () => Promise<void>;
  onDeleted: () => void;
}) {
  const numberRef = useRef(number);
  numberRef.current = number;

  const [confirming, setConfirming] = useState(false);
  const [deletingNumber, setDeletingNumber] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setConfirming(false);
    setError(null);
  }, [number]);

  const request = () => {
    setError(null);
    setConfirming(true);
  };
  const cancel = () => {
    setConfirming(false);
  };

  const confirm = async () => {
    if (number === null || deletingNumber !== null) return;
    setError(null);
    setDeletingNumber(number);
    const target = number;
    try {
      await remove();
    } catch (err) {
      setError(
        err instanceof ConvexError ? String(err.data) : "削除に失敗しました",
      );
      setDeletingNumber(null);
      return; // confirming は維持し、開いたパネルにエラーを表示する
    }
    if (numberRef.current === target) {
      onDeleted();
    } else {
      setDeletingNumber(null);
    }
  };

  return {
    confirming,
    busy: deletingNumber !== null,
    error,
    /** 表示中 number への削除が in-flight か（null 分岐で loading 維持判定に使う） */
    isDeletingCurrent: deletingNumber === number,
    request,
    cancel,
    confirm: () => void confirm(),
  };
}
