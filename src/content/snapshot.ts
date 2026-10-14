import type { QuoteSnapshot, Snapshot } from '../shared/models';
import type { FillView } from '../shared/storage';
import { mergeSegments, safeHref, type Segment } from '../shared/segments';
import { isTranslatedQuoteText, findQuote, ownPostLink, queryAllFirst, queryAllInQuote, queryAllOwn, queryFirst, queryFirstInQuote, queryOwn } from '../shared/selectors';

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
  /** DOM のメディアがまだ読めない印。snapshot には含めず、保存しない。 */
  mediaPending?: true;
  /** プロフィールアイコンの img が無い、またはまだ読み込まれていない印。snapshot には含めず、保存しない。 */
  avatarPending?: true;
  /** 引用のアイコンについての、avatarPending と同じ印 */
  quoteAvatarPending?: true;
}

/** まだ読み込み中の項目 (メディア・アイコン・引用のアイコン) があるか。取り込みの待ちと、補完の確認済みの判定が、この 1 か所を使う */
export const hasPending = (ex: Extracted): boolean => !!(ex.mediaPending || ex.avatarPending || ex.quoteAvatarPending);

/** 画像が読み込み済みか。src が空のままの img は、src プロパティがページの URL を返すことがあるので、属性で見る */
function imageReady(img: HTMLImageElement | undefined): boolean {
  return !!img && !!img.getAttribute('src')?.trim() && img.complete && img.naturalWidth > 0;
}

/**
 * 保存済みポストの補完 (fillMissing / missingFields) に渡す、画面側の値。
 * 読み込み途中の項目 (アイコン・メディア) は外す。空の値を「画面側の値」として扱わないため。
 */
export function fillSource(ex: Extracted): FillView {
  const { author, handle, avatar, media, hasVideo, hasLink, videoPoster, createdAt, quote } = ex.snapshot;
  const source: FillView = { author, handle, avatar, media, hasVideo, hasLink, videoPoster, createdAt, quote };
  if (ex.avatarPending) delete source.avatar;
  if (ex.mediaPending) {
    source.media = [];
    delete source.hasVideo;
    delete source.videoPoster;
  }
  if (source.quote && ex.quoteAvatarPending) {
    source.quote = { ...source.quote };
    delete source.quote.avatar;
  }
  return source;
}

/** article 要素から、ポストの ID だけを軽く読む (extractTweet と同じ取り出し方。スナップショットは作らない)。取れなければ null */
export function tweetIdOf(article: Element): string | null {
  const { link } = ownPostLink(article);
  return link?.getAttribute('href')?.match(/^\/[^/]+\/status\/(\d+)/)?.[1] ?? null;
}

/** 動画のサムネイル (poster) は https の URL だけ使う (blob: などは保存しても開けない) */
const httpsPoster = (poster: string | null | undefined): string | undefined => (poster && /^https:\/\//i.test(poster) ? poster : undefined);

/** 引用は表示されていた本文・画像と動画のサムネイルだけ。再生や原文の取得はしない。 */
function extractQuote(article: Element): QuoteSnapshot | undefined {
  const el = findQuote(article);
  if (!el) return undefined;
  const name = queryFirstInQuote(el, 'userName')?.el;
  const author = (name ? queryFirstInQuote(name, 'nameText')?.el.textContent?.trim() : '') ?? '';
  const avatarHandle = queryFirstInQuote(el, 'quoteAvatarHandle')?.el.getAttribute('data-testid')?.match(/^UserAvatar-Container-([A-Za-z0-9_]+)$/)?.[1];
  const visibleHandle = name?.textContent?.match(/@([A-Za-z0-9_]+)/)?.[1];
  const handle = avatarHandle || visibleHandle;
  const textEl = queryFirstInQuote(el, 'tweetText')?.el;
  const text = textEl?.textContent?.trim() ?? '';
  const media = queryAllInQuote<HTMLImageElement>(el, 'quoteMedia').els.map((i) => i.src).filter(Boolean);
  const hasVideo = !!queryFirstInQuote(el, 'quoteVideo');
  const poster = hasVideo ? queryFirstInQuote(el, 'quoteVideoPoster')?.el.getAttribute('poster') : undefined;
  const videoPoster = httpsPoster(poster);
  if (!author && !handle && !text && !media.length && !hasVideo) return undefined;
  const avatar = queryFirstInQuote<HTMLImageElement>(el, 'avatar')?.el.src;
  const createdAt = queryFirstInQuote(el, 'time')?.el.getAttribute('datetime');
  const segments = textEl ? extractSegments(textEl) : undefined;
  const photo = queryAllInQuote(el, 'quotePhotoLink').els.map((a) => a.getAttribute('href')?.match(/^\/([A-Za-z0-9_]+)\/status\/(\d+)\/photo\/\d+(?:[?#].*)?$/)).find(Boolean);
  return {
    ...(hasVideo ? { hasVideo: true as const } : {}), ...(videoPoster ? { videoPoster } : {}),
    author, handle: handle ? '@' + handle : '', text, media,
    ...(avatar ? { avatar } : {}), ...(createdAt ? { createdAt } : {}), ...(segments ? { segments } : {}),
    ...(photo ? { url: 'https://x.com/' + photo[1] + '/status/' + photo[2] } : {}),
    ...(textEl && isTranslatedQuoteText(textEl) ? { translated: true } : {}),
  };
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
  const avatarEl = queryOwn<HTMLImageElement>(article, 'avatar')?.el;
  const avatar = avatarEl?.src || undefined;
  const media = queryAllOwn<HTMLImageElement>(article, 'media').els.filter((i) => i.getAttribute('src')?.trim()).map((i) => i.src).filter(Boolean);

  // 外部リンク: リンクカード、または本文中の t.co 等の外部 URL (メンション/ハッシュタグ/ポスト間リンクは除く)。推測 (実機未確認)
  const bodyLinks = (textEl ? queryAllFirst(textEl, 'bodyLink').els : []).some((a) => /^https?:\/\//i.test(a.getAttribute('href') ?? ''));
  const hasLink = !!queryOwn(article, 'linkCard') || bodyLinks;
  const hasVideo = !!queryOwn(article, 'video');
  const videoPoster = hasVideo ? httpsPoster(queryOwn(article, 'videoPoster')?.el.getAttribute('poster')) : undefined;

  // 自動翻訳後に出る「この翻訳を評価」のボタンを、翻訳済みの目印にする。実機で確認した範囲の推測。
  const translated = !!queryOwn(article, 'translationVote');
  // 写真が未読み込み: 写真リンクがあるのに画像が 0 枚、または、1 枚以上あるのにリンクの数より少ない (複数枚の一部だけ読み込み済み)。
  // リンクと画像の数が X の DOM で常に合うかは実機未確認の推測 (自分の部分だけを数える。合わなければ待ちが 1 ポストあたり最大 8 秒になるだけで、保存は止まらない)
  const photoLinks = queryAllOwn(article, 'photoLink').els.length;
  const photoPending = photoLinks > 0 && media.length < photoLinks;
  const quote = extractQuote(article);
  // 写真リンク自体が後から DOM に入る画像だけのポストを想定 (原因・DOM 構造は実機未確認の推測)。
  // 投票だけや削除済みなど、本当に本文も添付内容も無い表示でも、最大 8 秒で打ち切り保存は止まらない。
  const emptyPending = !text && !media.length && !hasVideo && !hasLink && !quote;
  const quoteEl = findQuote(article);
  const quoteAvatarEl = quoteEl ? queryFirstInQuote<HTMLImageElement>(quoteEl, 'avatar')?.el : undefined;
  // img 自体が後から DOM に入る可能性も待つ (原因・DOM 構造は実機未確認の推測)。
  // 広告や削除・非表示など、元からアイコンが無い表示も、1 ポストあたり最大 8 秒で打ち切り保存は止まらない。
  return {
    tweetId,
    ...(!imageReady(avatarEl) ? { avatarPending: true as const } : {}),
    ...(quoteEl && !imageReady(quoteAvatarEl) ? { quoteAvatarPending: true as const } : {}),
    ...((emptyPending || (hasVideo ? !videoPoster : photoPending)) ? { mediaPending: true as const } : {}),
    snapshot: {
      ...(quote ? { quote } : {}),
      ...(translated ? { translated: true } : {}),
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
