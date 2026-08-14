import { ConvexError } from "convex/values";
import { Component, type ReactNode } from "react";
import { DetailNotFound } from "../DetailPage/DetailNotFound";
import type { DetailEntity } from "../DetailPage/DetailPage";

/**
 * projectQuery（convex/lib/auth.ts）が非参加 linked Member に対して投げる
 * ConvexError のメッセージ。IssueDetail/TaskDetail は selected project の
 * メンバー一覧を経由せず projectKey/number の deep link で直接 useQuery する
 * ため、非参加者がこの URL を踏むと当該 query が throw する。
 */
const NOT_A_MEMBER_MESSAGE = "このプロジェクトに参加していません";

type Props = {
  backTo: string;
  entity: DetailEntity;
  children: ReactNode;
};

type State = { error: unknown };

const INITIAL_STATE: State = { error: undefined };

/**
 * IssueDetail/TaskDetail 専用のエラー境界（監査 PLAUSIBLE 指摘: 非参加
 * linked Member の deep link で汎用 ErrorBoundary の「エラーが発生しました」
 * クラッシュ画面に落ち、PR② 前は表示できていた「見つかりません」相当の
 * 案内が失われていた）。
 *
 * 非参加拒否（NOT_A_MEMBER_MESSAGE の ConvexError）だけを DetailNotFound へ
 * 縮退させ、それ以外の例外は render 内で再 throw して親の汎用
 * ErrorBoundary（Issue #17）に委譲する（App.tsx が両方を入れ子で配置する）。
 * 文言の磨き込み（「参加していません」の明示等）は PR③ で行うため、ここでは
 * 既存の DetailNotFound と同じ簡潔な案内に留める。
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
      return (
        <DetailNotFound
          backTo={this.props.backTo}
          entity={this.props.entity}
          error={null}
        />
      );
    }
    throw error;
  }
}
