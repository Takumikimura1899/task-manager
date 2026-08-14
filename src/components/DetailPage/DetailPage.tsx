import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import s from "./DetailPage.module.css";

export type DetailEntity = "Issue" | "Task";

/**
 * 「← 一覧へ」の deep link 系ページで共有するページ枠（戻り導線 + 本文）。
 * Issue/Task 詳細に加え、同型の枠（back リンク + max-width コンテナ）を
 * 必要とする ProjectMembers（メンバー管理・ADR-11 §7）もここを再利用する。
 * 中身のスタイル語彙（.section 等）は各画面ファミリの module.css 側に残し、
 * このコンポーネントは枠のみを提供する（フロントエンドCSS規約.md §3）。
 */
export function DetailPage({
  backTo,
  children,
}: {
  backTo: string;
  children: ReactNode;
}) {
  return (
    <main className={s.page}>
      <Link className={s.back} to={backTo}>
        ← 一覧へ
      </Link>
      {children}
    </main>
  );
}
