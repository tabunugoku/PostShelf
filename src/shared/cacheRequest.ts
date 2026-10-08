/** content script / サイドパネルから background への依頼 (画像のキャッシュ・掃除)。応答は待たない。届かなくても保存自体には影響しない */
function send(msg: { type: string; tweetId?: string; accountId?: string; ids?: string[]; kind?: string }): void {
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

/** たたまれた状態で保存したとき (v24)。background が、設定がオンなら、裏のタブで全文を取る */
export const requestFullText = (tweetId: string, accountId: string): void => send({ type: 'fetchFullText', tweetId, accountId });

/** 自動取り込みが終わったとき (v24)。取り込んだ truncated のポスト (最大 30 件は background が数える) の全文を、終わってから取る */
export const requestFullTextBatch = (accountId: string, ids: string[]): void => {
  if (ids.length) send({ type: 'fetchFullText', accountId, ids: ids.slice(0, 30), kind: 'auto' } as never);
};
