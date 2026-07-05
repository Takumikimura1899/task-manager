import { Component, type ErrorInfo, type ReactNode } from "react";
import s from "./ErrorBoundary.module.css";

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
};

/**
 * ルート単位のエラー境界。
 * Convex の useQuery はクエリ失敗時に例外を throw するため、
 * 捕捉しないと全画面が白画面クラッシュする（Issue #17）。
 * 描画中の例外を捕捉してフォールバック UI を表示し、
 * 「再試行」で children を再マウントして復帰を試みる
 * （フォールバック表示中は子ツリーがアンマウントされるため、
 * リセット後の再描画で新規マウントになる）。
 * エラー境界は React のクラスコンポーネントでのみ実装できる。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // エラー収集基盤は未導入のため、調査用に console へ出力する。
    console.error("ErrorBoundary が例外を捕捉しました:", error, info);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <main className={s.page} role="alert">
        <h1 className={s.title}>エラーが発生しました</h1>
        <p className={s.message}>
          データの取得中に問題が発生した可能性があります。
          通信環境を確認して、再試行してください。
        </p>
        <div className={s.actions}>
          <button className={s.retry} onClick={this.handleRetry} type="button">
            再試行
          </button>
          <button
            className={s.reload}
            onClick={this.handleReload}
            type="button"
          >
            ページを再読み込み
          </button>
        </div>
      </main>
    );
  }
}
