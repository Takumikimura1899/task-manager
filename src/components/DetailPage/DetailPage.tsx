import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import s from "./DetailPage.module.css";

export type DetailEntity = "Issue" | "Task";

/** Issue/Task 詳細で共有するページ枠（戻り導線 + 本文）。 */
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
