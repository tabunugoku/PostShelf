import type { Snapshot } from '../shared/models';
import { mergeSegments, safeHref, type Segment } from '../shared/segments';
import { ownPostLink, queryAllFirst, queryAllOwn, queryFirst, queryOwn } from '../shared/selectors';

/**
 * 本文の要素から、リンクを含む部品の並びを作る (v24)。リンクは URL / @メンション / #ハッシュタグ (本文中の <a>)。
 * v は画面に出ている文字のまま (X が途中を「…」に省略していても、そのまま)。href は X の画面の href (外部 URL は t.co の短縮 URL)。
 * 相対リンクは https://x.com を補う。http / https 以外は、リンクにしない。リンクが 1 つも無ければ undefined (text だけで足りる)。
 */
export function extractSegments(el: Element): Segment[] | undefined {
  const list: Segment[] = [];
  let hasLink = false;
  const walk = (n: Node) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) list.push({ t: 'text', v: c.textContent ?? '' });
      else if (c.nodeType === 1) {
        const e = c as Element;
        const href = e.tagName === 'A' ? safeHref(e.getAttribute('href')) : null;
        if (href) {
          list.push({ t: 'link', v: e.textContent ?? '', href });
          hasLink = true;
        } else walk(e);
      }
    }
  };
  walk(el);
  if (!hasLink) return undefined;
  const merged = mergeSegments(list);
  // text (trim 済み) と同じように、前後の空白を落とす
  if (merged[0]?.t === 'text') merged[0].v = merged[0].v.trimStart();
  const last = merged[merged.length - 1];
  if (last?.t === 'text') last.v = last.v.trimEnd();
  return mergeSegments(merged);
}

export interface Extracted {
  tweetId: string;
  snapshot: Snapshot;
}

/** article 要素から、ポストの ID だけを軽く読む (extractTweet と同じ取り出し方。スナップショットは作らない)。取れなければ null */
export function tweetIdOf(article: Element): string | null {
  const { link } = ownPostLink(article);
  return link?.getAttribute('href')?.match(/^\/[^/]+\/status\/(\d+)/)?.[1] ?? null;
}

/** article 要素からポストのスナップショットを作る。ID が取れなければ null。 */
export function extractTweet(article: Element): Extracted | null {
  const { time, link } = ownPostLink(article);
  const href = link?.getAttribute('href') ?? '';
  const m = href.match(/^\/([^/]+)\/status\/(\d+)/);
  if (!m) return null;
  const [, handle, tweetId] = m;

  const nameEl = queryOwn(article, 'userName')?.el;
  const author = (nameEl ? queryFirst(nameEl, 'nameText')?.el.textContent?.trim() : '') || handle;
  const textEl = queryOwn(article, 'tweetText')?.el;
  const text = textEl?.textContent?.trim() ?? '';
  const segments = textEl ? extractSegments(textEl) : undefined;
  const truncated = !!queryOwn(article, 'showMore'); // たたまれた状態か (実機未確認の推測。全文は、保存のあと別に取る)
  const avatar = queryOwn<HTMLImageElement>(article, 'avatar')?.el.src || undefined;
  const media = queryAllOwn<HTMLImageElement>(article, 'media').els.map((i) => i.src).filter(Boolean);

  // 外部リンク: リンクカード、または本文中の t.co 等の外部 URL (メンション/ハッシュタグ/ポスト間リンクは除く)。推測 (実機未確認)
  const bodyLinks = (textEl ? queryAllFirst(textEl, 'bodyLink').els : []).some((a) => /^https?:\/\//i.test(a.getAttribute('href') ?? ''));
  const hasLink = !!queryOwn(article, 'linkCard') || bodyLinks;
  const hasVideo = !!queryOwn(article, 'video');
  const videoPoster = hasVideo ? queryOwn(article, 'videoPoster')?.el.getAttribute('poster') || undefined : undefined;

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
      ...(truncated ? { truncated: true } : {}),
      ...(segments ? { segments } : {}),
    },
  };
}
