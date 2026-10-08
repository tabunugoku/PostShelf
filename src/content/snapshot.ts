import type { Snapshot } from '../shared/models';
import { queryAllFirst, queryFirst } from '../shared/selectors';

export interface Extracted {
  tweetId: string;
  snapshot: Snapshot;
}

/** article 要素からポストのスナップショットを作る。ID が取れなければ null。 */
export function extractTweet(article: Element): Extracted | null {
  const time = queryFirst(article, 'time')?.el ?? null;
  const link = (time?.closest('a') ?? queryFirst(article, 'statusLink')?.el) as HTMLAnchorElement | null;
  const href = link?.getAttribute('href') ?? '';
  const m = href.match(/^\/([^/]+)\/status\/(\d+)/);
  if (!m) return null;
  const [, handle, tweetId] = m;

  const nameEl = queryFirst(article, 'userName')?.el;
  const author = nameEl?.querySelector('span')?.textContent?.trim() || handle;
  const text = queryFirst(article, 'tweetText')?.el.textContent?.trim() ?? '';
  const avatar = queryFirst<HTMLImageElement>(article, 'avatar')?.el.src || undefined;
  const media = queryAllFirst<HTMLImageElement>(article, 'media').els.map((i) => i.src).filter(Boolean);

  // 外部リンク: リンクカード、または本文中の t.co 等の外部 URL (メンション/ハッシュタグ/ポスト間リンクは除く)。推測 (実機未確認)
  const bodyLinks = [...(queryFirst(article, 'tweetText')?.el.querySelectorAll('a[href]') ?? [])].some((a) => /^https?:\/\//i.test(a.getAttribute('href') ?? ''));
  const hasLink = !!queryFirst(article, 'linkCard') || bodyLinks;
  const hasVideo = !!queryFirst(article, 'video');
  const videoPoster = hasVideo ? queryFirst(article, 'videoPoster')?.el.getAttribute('poster') || undefined : undefined;

  return {
    tweetId,
    snapshot: {
      text,
      author,
      handle: `@${handle}`,
      avatar,
      media,
      createdAt: time?.getAttribute('datetime') ?? undefined,
      url: `https://x.com/${handle}/status/${tweetId}`,
      hasVideo,
      hasLink,
      ...(videoPoster ? { videoPoster } : {}),
    },
  };
}
