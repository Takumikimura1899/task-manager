import { Link } from "react-router-dom";
import s from "./NotFound.module.css";

/**
 * 未定義 URL のフォールバック画面（Issue #16）。
 * App のルーティングで path="*" に割り当て、未知 URL で空白画面に
 * ならないよう案内とホームへ戻る導線を表示する。
 */
export function NotFound() {
  return (
    <main className={s.page}>
      <Link className={s.back} to="/">
        ← 一覧へ
      </Link>
      <h1 className={s.title}>ページが見つかりませんでした</h1>
      <p className="hint">
        URL が誤っているか、ページが移動または削除された可能性があります。
      </p>
    </main>
  );
}
