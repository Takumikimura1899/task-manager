import type { ReactNode } from "react";
import s from "./FilterBar.module.css";

/**
 * フィルタ解除ボタン（Issue #92）。FilterBar 内蔵のクリアボタンと、
 * Board の「フィルタで全滅」空状態のクリア導線とで実装を共有するために
 * 切り出した。見た目は variant で切り替える（再レビュー指摘6）:
 * - "bar"（デフォルト）: FilterBar 内の地味なボタン（.clear）
 * - "inline": 文中リンクとしての視認性を持たせる（utilities の
 *   .inline-link）。Board の空状態メッセージ文中で使う。この見た目は
 *   Board の Issue 一覧への誘導リンク（react-router の Link）とも共有する
 *   単一ソースのため、コンポーネント固有 CSS ではなく utilities 側に置く
 *   （Issue #106、フロントエンドCSS規約.md §3）。
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
      className={variant === "inline" ? "inline-link" : s.clear}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
