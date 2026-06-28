import type { Doc } from "../../../convex/_generated/dataModel";
import s from "./GitLinkList.module.css";

export type GitLinkItem = Doc<"gitLinks"> & { remoteUrl: string | null };

const TYPE_LABELS: Record<GitLinkItem["type"], string> = {
  branch: "ブランチ",
  commit: "コミット",
  pull_request: "PR",
};

const PR_STATE_LABELS: Record<NonNullable<GitLinkItem["prState"]>, string> = {
  draft: "下書き",
  open: "オープン",
  merged: "マージ済み",
  closed: "クローズ",
};

/**
 * href に使ってよい URL かをスキームで検証する（XSS 対策）。
 * javascript:/data: 等を排除し、http(s) のみリンク化を許可する。
 * 不正・解析不能なら undefined を返し、呼び出し側はプレーンテキスト表示にフォールバックする。
 */
function safeHref(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

/** Task に紐づく Git アーティファクト（branch/commit/PR）の一覧表示。 */
export function GitLinkList({ links }: { links: GitLinkItem[] }) {
  if (links.length === 0) {
    return <p className="hint">連携している Git 情報はありません。</p>;
  }

  return (
    <ul className={s.list}>
      {links.map((link) => {
        const href = safeHref(link.url);
        return (
          <li className={s.item} key={link._id}>
            <span className={s.type}>{TYPE_LABELS[link.type]}</span>
            {href === undefined ? (
              // http(s) 以外のスキームはリンク化せずプレーンテキストで表示する。
              <span className={s.ref}>{link.externalRef}</span>
            ) : (
              <a
                className={s.ref}
                href={href}
                rel="noreferrer noopener"
                target="_blank"
              >
                {link.externalRef}
              </a>
            )}
            {link.prState !== undefined && (
              <span className={`${s.state} ${s[link.prState]}`}>
                {PR_STATE_LABELS[link.prState]}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
