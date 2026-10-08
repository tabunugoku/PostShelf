import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { assignOrder } from '../src/shared/ordering';
import { addCollected, listBookmarks, setAccountScope } from '../src/shared/storage';
import { UNKNOWN_ACCOUNT_ID } from '../src/shared/models';

// x.com のブックマークの並び: p1 がいちばん新しく追加したもの (一覧の先頭)、p20 がいちばん古い
const ids = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `p${from + i}`);
const item = (id: string) => ({ tweetId: id, snapshot: { text: id, author: 'A', handle: '@a', media: [], url: `https://x.com/a/status/${id.slice(1)}` } });
const items = (from: number, to: number) => ids(from, to).map(item);
/** PostShelf の「保存が新しい順」 = savedAt の降順 */
const shelfOrder = async () => (await listBookmarks()).sort((a, b) => b.savedAt - a.savedAt).map((b) => b.tweetId);
const T = 1_800_000_000_000;
let data: Record<string, any>;

beforeEach(() => {
  data = installChromeMock() as Record<string, any>;
  setAccountScope(UNKNOWN_ACCOUNT_ID);
});

describe('assignOrder (pure)', () => {
  it('first run (no anchors): T − i×1000', () => {
    const m = assignOrder([{ id: 'a' }, { id: 'b' }, { id: 'c' }], T);
    expect([m.get('a'), m.get('b'), m.get('c')]).toEqual([T, T - 1000, T - 2000]);
  });
  it('U only (nothing below yet): U − (i+1)×1000', () => {
    const m = assignOrder([{ id: 'u', savedAt: 50_000 }, { id: 'a' }, { id: 'b' }], T);
    expect([m.get('a'), m.get('b')]).toEqual([49_000, 48_000]);
  });
  it('L only (top segment): T − i×1000, but above L', () => {
    const m = assignOrder([{ id: 'a' }, { id: 'b' }, { id: 'l', savedAt: 10_000 }], 20_000);
    expect([m.get('a'), m.get('b')]).toEqual([20_000, 19_000]);
    const low = assignOrder([{ id: 'a' }, { id: 'b' }, { id: 'l', savedAt: 50_000 }], 20_000); // T が L より小さい → L の上に積む
    expect([low.get('a'), low.get('b')]).toEqual([52_000, 51_000]);
  });
  it('U and L (U > L): n items spread evenly between them', () => {
    const m = assignOrder([{ id: 'u', savedAt: 10_000 }, { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'l', savedAt: 6_000 }], T);
    expect([m.get('a'), m.get('b'), m.get('c')]).toEqual([9_000, 8_000, 7_000]);
  });
  it('U ≤ L: just below U (U − (i+1) ms), nothing is lost', () => {
    const m = assignOrder([{ id: 'u', savedAt: 5_000 }, { id: 'a' }, { id: 'b' }, { id: 'l', savedAt: 9_000 }], T);
    expect([m.get('a'), m.get('b')]).toEqual([4_999, 4_998]);
  });
  it('several segments in one sequence are handled independently', () => {
    const m = assignOrder([{ id: 'a' }, { id: 'x', savedAt: 100_000 }, { id: 'b' }, { id: 'c' }, { id: 'y', savedAt: 40_000 }, { id: 'd' }], T);
    expect(m.get('a')! > 100_000).toBe(true);
    expect(m.get('b')! < 100_000 && m.get('b')! > m.get('c')! && m.get('c')! > 40_000).toBe(true);
    expect(m.get('d')).toBe(39_000);
  });
});

describe('B-2: PostShelf order equals the x.com order', () => {
  it('first run: the 20 posts come out in the same order (newest = first in the list)', async () => {
    expect(await addCollected(items(1, 20), T)).toBe(20);
    expect(await shelfOrder()).toEqual(ids(1, 20));
  });

  it('stop and resume (even across a page reload): saved posts do not change, new ones land at their X position', async () => {
    await addCollected(items(1, 12), T); // 途中で一時停止 (そこまでの分を保存)
    const before = Object.fromEntries((await listBookmarks()).map((b) => [b.tweetId, b.savedAt]));
    // ページを再読み込み → 先頭からもう一度スクロール。取り込み済みの 12 件は基準になり、続きの 13〜20 が入る
    expect(await addCollected(items(1, 20), T + 60_000)).toBe(8);
    expect(await shelfOrder()).toEqual(ids(1, 20));
    for (const b of await listBookmarks()) if (before[b.tweetId] !== undefined) expect(b.savedAt).toBe(before[b.tweetId]);
  });

  it('flushing in several batches during one run keeps the order', async () => {
    const seq = items(1, 20);
    for (const n of [5, 10, 15, 20]) await addCollected(seq.slice(0, n), T); // 20 件ごと・停止時などの保存
    expect(await shelfOrder()).toEqual(ids(1, 20));
  });

  it('segments between already imported posts (saved with the PostShelf button earlier)', async () => {
    // p5 と p12 は、先に PostShelf のボタンで保存してあった (一覧の並びと同じ向き: p5 のほうが新しい)
    data.folders = [];
    await addCollected([item('p5')], T - 100_000);
    await addCollected([item('p12')], T - 500_000);
    const anchors = Object.fromEntries((await listBookmarks()).map((b) => [b.tweetId, b.savedAt]));
    expect(anchors.p5 > anchors.p12).toBe(true);
    expect(await addCollected(items(1, 20), T)).toBe(18);
    expect(await shelfOrder()).toEqual(ids(1, 20));
    for (const b of await listBookmarks()) if (anchors[b.tweetId] !== undefined) expect(b.savedAt).toBe(anchors[b.tweetId]); // 取り込み済みは変えない
  });

  it('a new bookmark added on X during the run appears at the top of the list: it goes above the saved ones', async () => {
    await addCollected(items(2, 20), T);
    expect(await addCollected(items(1, 20), T + 3_600_000)).toBe(1);
    expect(await shelfOrder()).toEqual(ids(1, 20));
    // 開始時刻が古くても (L より大きくならなくても) L の上に積む
    await addCollected([item('p0'), ...items(1, 20)], T - 10_000_000);
    expect((await shelfOrder())[0]).toBe('p0');
  });

  it('U ≤ L (the saved times do not match the list order): no data is lost, the new posts go just below U', async () => {
    await addCollected([item('p5')], T - 500_000); // p5 のほうが古い時刻で保存されていた (並びと逆)
    await addCollected([item('p12')], T - 100_000);
    const total = await addCollected(items(1, 20), T);
    expect(total).toBe(18);
    const list = await listBookmarks();
    expect(list.length).toBe(20);
    const at = Object.fromEntries(list.map((b) => [b.tweetId, b.savedAt]));
    for (let i = 6; i <= 11; i++) expect(at[`p${i}`] < at.p5).toBe(true); // 区間は U (p5) のすぐ下
    expect(at.p5).toBe(T - 500_000);
    expect(at.p12).toBe(T - 100_000);
  });

  it('the manual import (the posts that are visible now) uses the same ordering and skips saved posts', async () => {
    await addCollected(items(3, 8), T); // いま見えている分だけ (手動)
    expect(await shelfOrder()).toEqual(ids(3, 8));
    expect(await addCollected(items(3, 8), T + 1000)).toBe(0); // 取り込み済みはスキップ
    expect(await addCollected(items(1, 20), T + 60_000)).toBe(14); // そのあと自動で全部
    expect(await shelfOrder()).toEqual(ids(1, 20));
  });

  it('existing data is not changed (no migration): posts saved before keep their savedAt and are only used as anchors', async () => {
    await addCollected([item('p3')], 123_456);
    await addCollected(items(1, 5), T);
    const p3 = (await listBookmarks()).find((b) => b.tweetId === 'p3')!;
    expect(p3.savedAt).toBe(123_456);
  });
});
