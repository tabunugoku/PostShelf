import type { QuoteSnapshot } from '../shared/models';
import { safeHref } from '../shared/segments';
import { formatDate, t } from '../shared/strings';
import { MediaImg } from './MediaImg';
import { MediaGrid } from './MediaGrid';
import { PostText, SearchContext } from './PostText';

/** 引用は保存時に見えていた範囲だけ。画像は本体のキャッシュと共有せず、URL のまま表示する。 */
export function QuoteBlock({ quote: q, tweetId }: { quote: QuoteSnapshot; tweetId: string }) {
  const safe = safeHref(q.url);
  const url = safe && /^https:\/\/(x|twitter)\.com\//i.test(safe) ? safe : null;
  const handle = q.handle.replace(/^@/, '');
  const profile = /^[A-Za-z0-9_]+$/.test(handle) ? safeHref('https://x.com/' + handle) : null;
  const author = <><strong>{q.author}</strong> <span class="muted">{q.handle}</span></>;
  return (
    <div class={`quote-block${url ? ' linked' : ''}`} aria-label={t('quoteLabel')} title={t('quoteAsSeen')}
      onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
      {url && <a class="quote-open" href={url} target="_blank" rel="noopener noreferrer" aria-label={t('openOnX')} />}
      <div class="quote-content">
        <div class="quote-head">
          {q.avatar && <img class="quote-avatar" src={q.avatar} alt="" loading="lazy" />}
          <div class="quote-identity">
            {!url && profile ? <a class="quote-author" href={profile} target="_blank" rel="noopener noreferrer">{author}</a> : <span>{author}</span>}
            {q.createdAt && <span class="muted"> · {formatDate(q.createdAt)}</span>}
          </div>
        </div>
        <SearchContext.Provider value=""><PostText s={q} /></SearchContext.Provider>
        {q.media.length > 0 && <MediaGrid count={q.media.length}>
          {q.media.slice(0, 4).map((src, i) => <div class="quote-photo"><MediaImg tweetId={tweetId} name={'quote-' + (i + 1)} src={src} cacheable={false} alt="" loading="lazy" /></div>)}
        </MediaGrid>}
      </div>
    </div>
  );
}
