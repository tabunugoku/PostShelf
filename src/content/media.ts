/** いまの DOM に出ている保存済みポストの、欠けた項目 (画像・動画・アイコンなど) だけを補う。スクロール・クリック・ページ移動はしない。 */
import { fillMissing, getFillViews, missingFields, onDataChanged, type FillView } from '../shared/storage';
import { getCurrentAccount, subscribeAccount } from './account';
import { collectVisible, pathListeners, SAVED_TTL_MS } from './collect';
import type { Snapshot } from '../shared/models';
import { fillSource, type Extracted } from './snapshot';

interface MediaDeps {
  now(): number;
  accountId(): string | null;
  path(): string;
  visible(): Extracted[];
  fillViews(accountId: string): Promise<Map<string, FillView>>;
  backfill(items: { tweetId: string; snapshot: Snapshot }[], accountId: string): Promise<number>;
}

export class VisibleMediaBackfill {
  private checked = new Set<string>();
  private context = '';
  private cache: { account: string; at: number; views: Map<string, FillView> } | null = null;
  private running: Promise<number> | null = null;

  constructor(private d: MediaDeps = {
    now: () => Date.now(), accountId: () => getCurrentAccount()?.id ?? null,
    path: () => location.pathname, visible: () => collectVisible(),
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
    if (!this.cache || this.cache.account !== account || this.d.now() - this.cache.at >= SAVED_TTL_MS) {
      const views = await this.d.fillViews(account);
      if (account !== this.d.accountId() || context !== account + ':' + this.d.path()) return 0;
      this.cache = { account, at: this.d.now(), views };
    }
    // 読み込みを待つ間に仮想化・移動されていても、いまの DOM だけを対象にする。
    const visible = this.d.visible();
    const present = new Set(visible.map(it => it.tweetId));
    for (const id of this.checked) if (!present.has(id)) this.checked.delete(id);
    // 補える項目があるものだけ送る。読み込み途中 (アイコン・メディア) のものは、読み込まれてから補えるよう、確認済みにしない
    const sources: { tweetId: string; snapshot: Snapshot }[] = [];
    for (const it of visible) {
      const view = this.cache.views.get(it.tweetId);
      if (!view || this.checked.has(it.tweetId)) continue;
      const snapshot = fillSource(it);
      const patch = missingFields(view, snapshot);
      if (!patch) continue;
      if (!it.mediaPending && !it.avatarPending && !it.quoteAvatarPending) this.checked.add(it.tweetId);
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
