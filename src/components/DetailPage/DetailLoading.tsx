import { Skeleton } from "../Skeleton/Skeleton";
import { DetailPage, type DetailEntity } from "./DetailPage";
import s from "./DetailPage.module.css";

/**
 * 読み込み中もページ枠と戻り導線を維持し、見出し・本文セクションの矩形を
 * スケルトンで示す（Issue #29：全画面差し替えをやめる）。
 */
export function DetailLoading({
  backTo,
  entity,
}: {
  backTo: string;
  entity: DetailEntity;
}) {
  return (
    <DetailPage backTo={backTo}>
      <output aria-label={`${entity} を読み込み中`} className={s.loading}>
        <Skeleton className={s.skeletonHeading} />
        <Skeleton className={s.skeletonTitle} />
        <Skeleton className={s.skeletonSection} />
        <Skeleton className={s.skeletonSection} />
      </output>
    </DetailPage>
  );
}
