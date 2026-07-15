import type { ReactNode } from "react";
import s from "./FilterBar.module.css";

/**
 * フィルタ解除ボタン（Issue #92）。FilterBar 内蔵のクリアボタンと、
 * Board の「フィルタで全滅」空状態のクリア導線とで見た目を共有するために
 * 切り出した（.clear スタイルを唯一の実装として使い回す）。
 * 文言は呼び出し側の文脈に応じて children で変える（デフォルトは「クリア」）。
 */
export function FilterClearButton({
  onClick,
  children = "クリア",
}: {
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button className={s.clear} onClick={onClick} type="button">
      {children}
    </button>
  );
}
