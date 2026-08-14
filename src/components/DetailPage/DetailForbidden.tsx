import { DetailPage } from "./DetailPage";

/**
 * 非参加拒否（projectQuery が投げる ConvexError「このプロジェクトに参加して
 * いません」）専用の案内（DetailErrorBoundary から使う）。データが存在しない
 * DetailNotFound とは原因が異なる（対象は存在するが閲覧権限が無い）ため、
 * 文言を分ける（ADR-11 PR③: PR② の暫定文言の整備）。
 */
export function DetailForbidden({ backTo }: { backTo: string }) {
  return (
    <DetailPage backTo={backTo}>
      <p className="hint">
        このプロジェクトに参加していません。プロジェクトのオーナーにメンバー追加を依頼してください。
      </p>
    </DetailPage>
  );
}
