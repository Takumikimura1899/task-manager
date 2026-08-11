import { DetailPage, type DetailEntity } from "./DetailPage";

/**
 * 並行削除（他ユーザーが先に削除）と自分の削除失敗が重なった場合、
 * error を拾わないと ConfirmPanel 内のエラー表示に到達できずサイレント失敗に
 * なる（Issue #104）。null 許容だが省略はできない必須 props とし、
 * 呼び出し側に「エラーがない」ことの明示を強制する。
 */
export function DetailNotFound({
  backTo,
  entity,
  error,
}: {
  backTo: string;
  entity: DetailEntity;
  error: string | null;
}) {
  return (
    <DetailPage backTo={backTo}>
      <p className="hint">{`${entity} が見つかりませんでした。`}</p>
      {error !== null && (
        <p className="actionError" role="alert">
          {error}
        </p>
      )}
    </DetailPage>
  );
}
