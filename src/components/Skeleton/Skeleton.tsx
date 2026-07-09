import s from "./Skeleton.module.css";

/**
 * ローディング中に実コンテンツの矩形を模して表示するプレースホルダ（Issue #29）。
 * 装飾要素のため aria-hidden とし、SR への通知は呼び出し側の
 * <output>（aria-label="〜を読み込み中"）コンテナが担う。
 * 寸法は呼び出し側が className（各 module.css）で与える。
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={
        className === undefined ? s.skeleton : `${s.skeleton} ${className}`
      }
    />
  );
}
