/** content script / サイドパネルから background への依頼 (画像のキャッシュ・掃除)。応答は待たない。届かなくても保存自体には影響しない */
function send(msg: { type: string; tweetId?: string; accountId?: string }): void {
  try {
    const p = chrome.runtime?.sendMessage?.(msg) as Promise<unknown> | undefined;
    p?.catch?.(() => {});
  } catch {
    /* 何もしない */
  }
}

/** ポストを保存したとき。キャッシュがオフなら background は何もしない */
export const requestCache = (tweetId: string, accountId: string): void => send({ type: 'cacheImages', tweetId, accountId });

/** ポストを保存から外したとき。どのアカウントにも無くなったポストの画像を background が消す */
export const requestPrune = (): void => send({ type: 'pruneCache' });
