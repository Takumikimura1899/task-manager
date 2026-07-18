import type { ReactNode } from "react";
import s from "./FilterBar.module.css";

/**
 * フィルタ解除ボタン（Issue #92）。FilterBar 内蔵のクリアボタンと、
 * Board の「フィルタで全滅」空状態のクリア導線とで実装を共有するために
 * 切り出した。見た目は variant で切り替える（再レビュー指摘6）:
 * - "bar"（デフォルト）: FilterBar 内の地味なボタン（.clear）
 * - "inline": 文中リンクとしての視認性を持たせる。色・下線・hover・遷移は
 *   utilities の .inline-link（Board の Issue 一覧誘導リンクと共有する
 *   単一ソース、Issue #106）、余白・font-size・button 要素リセットは
 *   ローカルの .clearInline を組み合わせる（フロントエンドCSS規約.md §3。
 *   button 固有の余白まで utilities に混ぜると a 要素側の余白が変わって
 *   しまうため分離している）。
 * 文言は呼び出し側の文脈に応じて children で変える（デフォルトは「クリア」）。
 */
export function FilterClearButton({
  onClick,
  children = "クリア",
  variant = "bar",
}: {
  onClick: () => void;
  children?: ReactNode;
  variant?: "bar" | "inline";
}) {
  return (
    <button
      className={
        variant === "inline" ? `inline-link ${s.clearInline}` : s.clear
      }
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
