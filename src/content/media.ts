/** いまの DOM に出ている保存済みポストの、欠けた項目 (画像・動画・アイコンなど) だけを補う。スクロール・クリック・ページ移動はしない。 */
import { fillMissing, getFillViews, missingFields, onDataChanged, type FillView } from '../shared/storage';
import { getCurrentAccount, subscribeAccount } from './account';
import { collectVisible, pathListeners, SAVED_TTL_MS } from './collect';
import { extractTweet, fillSource, hasPending, tweetIdOf, type Extracted } from './snapshot';
import { queryAllFirst } from '../shared/selectors';

interface MediaDeps {
  now(): number;
  accountId(): string | null;
  path(): string;
  visible(): Extracted[];
  visibleIds?(): string[];
  visibleForIds?(ids: ReadonlySet<string>): Extracted[];
  fillViews(accountId: string): Promise<Map<string, FillView>>;
  backfill(items: { tweetId: string; snapshot: FillView }[], accountId: string): Promise<number>;
}

/** 対象 ID の最後の記事だけを読む。重複の順番と採用する記事は collectVisible と同じ。 */
function readVisibleForIds(ids: ReadonlySet<string>): Extracted[] {
  if (!ids.size) return [];
  const articles = new Map<string, Element>();
  for (const article of queryAllFirst(document, 'tweet').els) {
    const id = tweetIdOf(article);
    if (id && ids.has(id)) articles.set(id, article);
  }
  const visible: Extracted[] = [];
  for (const article of articles.values()) {
    const extracted = extractTweet(article);
    if (extracted) visible.push(extracted);
  }
  return visible;
}

export class VisibleMediaBackfill {
  private checked = new Set<string>();
  private context = '';
  private cache: { account: string; at: number; views: Map<string, FillView> } | null = null;
  private running: Promise<number> | null = null;

  constructor(private d: MediaDeps = {
    now: () => Date.now(), accountId: () => getCurrentAccount()?.id ?? null,
    path: () => location.pathname, visible: () => collectVisible(),
    visibleIds: () => queryAllFirst(document, 'tweet').els.map(tweetIdOf).filter((id): id is string => !!id),
    visibleForIds: readVisibleForIds,
    fillViews: getFillViews, backfill: fillMissing,
  }) {}

  invalidate(): void { this.cache = null; }

  update(): Promise<number> {
    if (this.running) return this.running;
    this.running = this.read().finally(() => { this.running = null; });
    return this.running;
  }

  private async read(): Promise<number> {
    const account = this.d.accountId();
    const context = account + ':' + this.d.path();
    if (context !== this.context) {
      this.context = context;
      this.checked.clear();
      this.cache = null;
    }
    if (!account) return 0;
    // 先に ID だけ確認する。確認済みの画面では、保存データの全件も本文・画像も読み直さない。
    const ids = new Set(this.d.visibleIds?.() ?? this.d.visible().map((it) => it.tweetId));
    for (const id of this.checked) if (!ids.has(id)) this.checked.delete(id);
    if (![...ids].some((id) => !this.checked.has(id))) return 0;
    if (!this.cache || this.cache.account !== account || this.d.now() - this.cache.at >= SAVED_TTL_MS) {
      const views = await this.d.fillViews(account);
      if (account !== this.d.accountId() || context !== account + ':' + this.d.path()) return 0;
      this.cache = { account, at: this.d.now(), views };
    }
    // 読み込みを待つ間に仮想化・移動されていても、いまの DOM だけを対象にする。
    const fallbackVisible = this.d.visibleIds ? undefined : this.d.visible();
    const present = new Set(this.d.visibleIds?.() ?? fallbackVisible!.map((it) => it.tweetId));
    for (const id of this.checked) if (!present.has(id)) this.checked.delete(id);
    const views = this.cache.views;
    const targetIds = new Set([...present].filter((id) => views.has(id) && !this.checked.has(id)));
    const visible = this.d.visibleForIds?.(targetIds) ?? fallbackVisible ?? this.d.visible();
    // 補える項目があるものだけ送る。読み込み途中 (アイコン・メディア) のものは、読み込まれてから補えるよう、確認済みにしない
    const sources: { tweetId: string; snapshot: FillView }[] = [];
    for (const it of visible) {
      const view = this.cache.views.get(it.tweetId);
      if (!view || this.checked.has(it.tweetId)) continue;
      const snapshot = fillSource(it);
      const patch = missingFields(view, snapshot);
      if (!hasPending(it)) this.checked.add(it.tweetId);
      if (!patch) continue;
      sources.push({ tweetId: it.tweetId, snapshot });
    }
    return sources.length ? this.d.backfill(sources, account) : 0;
  }
}

const media = new VisibleMediaBackfill();
let timer: ReturnType<typeof setTimeout> | undefined;
/** 既存の DOM の見張りから呼ぶ。変化を 300ms にまとめ、未読の src/poster は後の通知で読む。 */
export function scheduleMediaBackfill(): void {
  clearTimeout(timer);
  timer = setTimeout(() => void media.update().catch(() => {}), 300);
}

export function installMediaBackfill(): () => void {
  const changed = () => { media.invalidate(); scheduleMediaBackfill(); };
  const offs = [onDataChanged(changed), subscribeAccount(changed)];
  pathListeners.add(changed);
  scheduleMediaBackfill();
  return () => { offs.forEach(off => off()); pathListeners.delete(changed); clearTimeout(timer); };
}
