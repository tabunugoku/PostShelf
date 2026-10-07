/**
 * X の画面構造の自己診断 (自動更新はしない。外部サーバーからセレクタを取得することもしない)。
 *
 * - ポストが 1 件以上表示されているとき、必要な要素が見つかるかを検査する
 * - 3 状態: ok (すべて 1 番目の候補で見つかった) / degraded (フォールバックで見つかった要素がある) / broken (見つからない要素がある)
 * - 結果は chrome.storage.local の `health` に保存する (外部には送らない)
 * - broken のとき: PostShelf のボタンを挿入せず、置き換えモードの横取りも、連動モードのクリックもしない (X 標準の動作に一切触れない)
 * - DOM の変化のたびに検査するが、実行は 10 秒以上の間隔にスロットルする
 */
import { queryAllFirst, queryFirst, type SelKey } from '../shared/selectors';
import { saveHealth, type Health, type HealthState } from '../shared/settings';

/**
 * 検査する要素。表示中のポストのうち 1 件でも見つかればその要素は「ある」とみなす (集計は全表示ポストで行う)。
 * 本文 (tweetText) は、画像だけのポストなど無いことがあるので、3 件以上表示されていて 1 件も無いときだけ「無い」とする。
 */
const REQUIRED: SelKey[] = ['userName', 'bookmarkButton', 'actionGroup', 'time', 'statusLink'];
const NEEDS_MANY: SelKey[] = ['tweetText'];
const MANY = 3;

export const THROTTLE_MS = 10_000;
const MAX_ARTICLES = 20;

export interface HealthResult {
  state: HealthState;
  missing: string[];
  fallback: string[];
  /** 検査したポスト数 */
  articles: number;
}

/**
 * 純粋な検査。ポスト (tweet) が 1 件も見えなければ null (判定しない)。
 * ただし「ポストへのリンク付きの time はあるのに tweet の容器が見つからない」ときは broken。
 */
export function inspect(root: ParentNode = document): HealthResult | null {
  const tweets = queryAllFirst(root, 'tweet');
  if (tweets.els.length === 0) {
    const looksLikePosts = root.querySelector('a[href*="/status/"] time') !== null;
    return looksLikePosts ? { state: 'broken', missing: ['tweet'], fallback: [], articles: 0 } : null;
  }
  const missing: string[] = [];
  const fallback: string[] = [];
  if (tweets.index > 0) fallback.push('tweet');
  const articles = tweets.els.slice(0, MAX_ARTICLES);

  const judge = (key: SelKey) => {
    let best = Infinity;
    for (const a of articles) {
      const f = queryFirst(a, key);
      if (f && f.index < best) best = f.index;
    }
    if (best === Infinity) return 'missing' as const;
    return best > 0 ? ('fallback' as const) : ('ok' as const);
  };
  for (const key of REQUIRED) {
    const r = judge(key);
    if (r === 'missing') missing.push(key);
    else if (r === 'fallback') fallback.push(key);
  }
  for (const key of NEEDS_MANY) {
    const r = judge(key);
    if (r === 'missing' && articles.length >= MANY) missing.push(key);
    else if (r === 'fallback') fallback.push(key);
  }
  const state: HealthState = missing.length ? 'broken' : fallback.length ? 'degraded' : 'ok';
  return { state, missing, fallback, articles: articles.length };
}

// ---- 現在の状態 (content script 内のメモリ) ----

let current: Health | null = null;
let lastRun = 0;
let lastSaved = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

export const getLocalHealth = (): Health | null => current;
export const isBroken = (): boolean => current?.state === 'broken';

/** 状態が変わったとき (broken へ / から) に呼ばれる。解除関数を返す */
export function subscribeHealth(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** テスト用: 状態とスロットルを初期化 */
export function resetHealth(): void {
  current = null;
  lastRun = 0;
  lastSaved = 0;
  clearTimeout(timer);
  timer = undefined;
}

const SAVE_EVERY_MS = 5 * 60_000;

/** 検査して結果を保存する (保存は変化があったとき、または 5 分ごと)。ポストが無ければ何もしない */
export function runHealthCheck(root: ParentNode = document, now = Date.now()): Health | null {
  lastRun = now;
  const r = inspect(root);
  if (!r) return current;
  const next: Health = { state: r.state, checkedAt: now, missing: r.missing, fallback: r.fallback };
  const prev = current;
  const changed = !prev || prev.state !== next.state || prev.missing.join() !== next.missing.join() || prev.fallback.join() !== next.fallback.join();
  current = next;
  if (changed || now - lastSaved >= SAVE_EVERY_MS) {
    lastSaved = now;
    void saveHealth(next);
  }
  if (!prev || (prev.state === 'broken') !== (next.state === 'broken')) listeners.forEach((l) => l());
  return next;
}

/** DOM の変化から呼ぶ。前回の実行から 10 秒以内なら、10 秒経った時点で 1 回だけ実行する */
export function scheduleHealthCheck(now = Date.now()): void {
  if (timer) return;
  const wait = lastRun === 0 ? 0 : Math.max(0, lastRun + THROTTLE_MS - now);
  timer = setTimeout(() => {
    timer = undefined;
    runHealthCheck();
  }, wait);
}

export function initHealth(): void {
  scheduleHealthCheck();
  new MutationObserver(() => scheduleHealthCheck()).observe(document.body, { childList: true, subtree: true });
}

