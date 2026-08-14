import { ConvexError } from "convex/values";
import { Component, type ReactNode } from "react";
import { DetailForbidden } from "../DetailPage/DetailForbidden";

/**
 * projectQuery（convex/lib/auth.ts）が非参加 linked Member に対して投げる
 * ConvexError のメッセージ。IssueDetail/TaskDetail/ProjectMembers は selected
 * project のメンバー一覧を経由せず projectKey（+ number）の deep link で
 * 直接 useQuery するため、非参加者がこの URL を踏むと当該 query が throw する。
 */
const NOT_A_MEMBER_MESSAGE = "このプロジェクトに参加していません";

type Props = {
  backTo: string;
  children: ReactNode;
};

type State = { error: unknown };

const INITIAL_STATE: State = { error: undefined };

/**
 * IssueDetail/TaskDetail/ProjectMembers 共通のエラー境界（監査 PLAUSIBLE
 * 指摘: 非参加 linked Member の deep link で汎用 ErrorBoundary の
 * 「エラーが発生しました」クラッシュ画面に落ちていた）。
 *
 * 非参加拒否（NOT_A_MEMBER_MESSAGE の ConvexError）だけを DetailForbidden へ
 * 縮退させ、それ以外の例外は render 内で再 throw して親の汎用
 * ErrorBoundary（Issue #17）に委譲する（App.tsx が両方を入れ子で配置する）。
 * PR② では「対象が見つかりません」相当の DetailNotFound に暫定で縮退させて
 * いたが、原因（データが無い／権限が無い）が異なるため PR③ で文言を分けた
 * （DetailForbidden 参照）。
 */
export class DetailErrorBoundary extends Component<Props, State> {
  state: State = INITIAL_STATE;

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  render(): ReactNode {
    const { error } = this.state;
    if (error === undefined) {
      return this.props.children;
    }
    if (error instanceof ConvexError && error.data === NOT_A_MEMBER_MESSAGE) {
      return <DetailForbidden backTo={this.props.backTo} />;
    }
    throw error;
  }
}
