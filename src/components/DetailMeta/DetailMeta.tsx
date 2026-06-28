import s from "./DetailMeta.module.css";

const dateFormat = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
});

/** Issue/Task 詳細で共有する作成者・作成日・更新日のメタ表示。 */
export function DetailMeta({
  createdByName,
  createdAt,
  updatedAt,
}: {
  createdByName: string | null;
  createdAt: number;
  updatedAt: number;
}) {
  return (
    <dl className={s.meta}>
      <dt className={s.term}>作成者</dt>
      <dd className={s.value}>{createdByName ?? "—"}</dd>
      <dt className={s.term}>作成日</dt>
      <dd className={s.value}>{dateFormat.format(createdAt)}</dd>
      <dt className={s.term}>更新日</dt>
      <dd className={s.value}>{dateFormat.format(updatedAt)}</dd>
    </dl>
  );
}
