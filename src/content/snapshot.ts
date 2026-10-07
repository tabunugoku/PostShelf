import type { Snapshot } from '../shared/models';
import { SEL } from '../shared/selectors';

export interface Extracted {
  tweetId: string;
  snapshot: Snapshot;
}

/** article 要素からポストのスナップショットを作る。ID が取れなければ null。 */
export function extractTweet(article: Element): Extracted | null {
  const time = article.querySelector(SEL.time);
  const link = (time?.closest('a') ?? article.querySelector(SEL.statusLink)) as HTMLAnchorElement | null;
  const href = link?.getAttribute('href') ?? '';
  const m = href.match(/^\/([^/]+)\/status\/(\d+)/);
  if (!m) return null;
  const [, handle, tweetId] = m;

  const nameEl = article.querySelector(SEL.userName);
  const author = nameEl?.querySelector('span')?.textContent?.trim() || handle;
  const text = article.querySelector(SEL.tweetText)?.textContent?.trim() ?? '';
  const avatar = article.querySelector<HTMLImageElement>(SEL.avatar)?.src || undefined;
  const media = [...article.querySelectorAll<HTMLImageElement>(SEL.media)].map((i) => i.src).filter(Boolean);

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
    },
  };
}
