import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { hasTweetStatusLink } from '../src/shared/selectors';
import { collectVisible } from '../src/content/collect';
import { getBookmark, listBookmarks, setAccountScope } from '../src/shared/storage';
import { installChromeMock } from './chrome-mock';
import { collectorWorld, loadFixture, markLoaded } from './v50-helpers';

let info: MockInstance<typeof console.info>;
const ready = () => {
  for (const [target, template] of [['main-avatar', 'late-avatar'], ['main-post', 'late-photo']]) {
    const source = document.getElementById(template) as HTMLTemplateElement;
    document.getElementById(target)!.append(source.content.cloneNode(true));
  }
  document.getElementById('main-text')!.textContent = '架空の遅れて現れた本文。';
  for (const img of document.querySelectorAll('img')) markLoaded(img);
};
const summary = () => {
  expect(info).toHaveBeenCalledTimes(1);
  expect(info.mock.calls[0][0]).toBe('[PostShelf] settle summary');
  return info.mock.calls[0][1];
};
const finish = (world: ReturnType<typeof collectorWorld>) => (world.collector as any).finish();
const order = async () => (await listBookmarks()).sort((a, b) => b.savedAt - a.savedAt).map((b) => b.tweetId);

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
  loadFixture('v53-settle-diagnosis.html');
  document.getElementById('quote-post')!.remove();
  info = vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});

afterEach(() => vi.restoreAllMocks());

it('待ち中に読み込まれたポストだけ resolved と数える', async () => {
  const world = collectorWorld((now) => {
    if (now === 600) ready();
  });
  await world.read();
  expect(info).not.toHaveBeenCalled();
  await finish(world);
  expect(summary()).toMatchObject({
    counts: { resolved: 1, timedOut: 0, vanished: 0, forced: 0, unflagged: 0 },
    screens: 1, unresolved: [],
  });
  expect(world.clock.sleeps).toEqual([300, 300]);
  expect((await getBookmark('1102'))!.snapshot.media).toHaveLength(1);
  expect(await order()).toEqual(['1101', '1102']);
});

it('時間切れの種類・画面内の位置・刻み・実時間・可視状態を記録する', async () => {
  let visibility: DocumentVisibilityState = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  const world = collectorWorld(() => { visibility = 'hidden'; });
  (world.collector as any).d.now = () => world.clock.now * 3 + 5;
  await world.read();
  await finish(world);
  expect(summary()).toMatchObject({
    counts: { resolved: 0, timedOut: 1, vanished: 0, forced: 0 }, screens: 1,
    unresolved: [{
      tweetId: '1102', pending: ['avatar', 'media'], position: 2, reason: 'timedOut',
      waitedMs: 8100, elapsedMs: 24300, visibilityStart: 'visible', visibilityEnd: 'hidden',
    }],
  });
  expect(world.clock.sleeps).toEqual(Array(27).fill(300));
  expect((await getBookmark('1102'))!.snapshot).toMatchObject({ avatar: undefined, media: [], text: '' });
  expect(await order()).toEqual(['1101', '1102']);
});

it('引用アイコンの待ちも数え同じ画面では待ち時間を重ねない', async () => {
  loadFixture('v53-settle-diagnosis.html');
  const world = collectorWorld();
  await world.read();
  await finish(world);
  expect(summary()).toMatchObject({ counts: { timedOut: 2 }, screens: 1 });
  expect(summary().unresolved[1]).toMatchObject({ tweetId: '1103', pending: ['quoteAvatar'], position: 3 });
  expect(world.clock.sleeps).toEqual(Array(27).fill(300));
});

it.each(['unreadable', 'removed'])('visible から消えた理由 %s を区別する', async (reason) => {
  const world = collectorWorld(() => {
    if (reason === 'unreadable') {
      document.getElementById('main-status')!.setAttribute('href', 'https://x.com/sample_slow/status/1102');
    } else document.getElementById('main-post')!.remove();
  });
  await world.read();
  await finish(world);
  expect(summary()).toMatchObject({
    counts: { vanished: 1, timedOut: 0 }, vanished: { [reason]: 1 },
    unresolved: [{ tweetId: '1102', reason: 'vanished', vanished: reason, waitedMs: 300, elapsedMs: 300 }],
  });
  expect((await getBookmark('1102'))!.snapshot.text).toBe('');
  expect(world.clock.sleeps).toEqual([300]);
  expect(await order()).toEqual(['1101', '1102']);
});

it.each(['pause', 'stop', 'finish'])('%s の最後の保存を forced と数える', async (method) => {
  let ending: Promise<void>;
  const world = collectorWorld((now) => {
    if (now === 600) ending = (world.collector as any)[method]();
  });
  await world.read();
  await ending!;
  expect(summary()).toMatchObject({
    counts: { forced: 1, resolved: 0, timedOut: 0, vanished: 0 },
    unresolved: [{ tweetId: '1102', reason: 'forced', waitedMs: 300, elapsedMs: 600 }],
  });
  expect((await getBookmark('1102'))!.snapshot.avatar).toBeUndefined();
  expect(world.clock.sleeps).toEqual([300, 300]);
  expect(await order()).toEqual(['1101', '1102']);
});

it('印の無いアイコン欠けと空の内容を unflagged と数えスキップは含めない', async () => {
  ready();
  const [first, second] = collectVisible();
  const items = [
    { ...first, snapshot: { ...first.snapshot, avatar: undefined } },
    { ...second, snapshot: { ...second.snapshot, media: [], text: '' } },
    { ...first, tweetId: '1104', snapshot: { ...first.snapshot, avatar: undefined } },
  ];
  const world = collectorWorld();
  Object.assign((world.collector as any).d, {
    visible: () => items, savedIds: async () => new Set(['1104']),
  });
  await world.read();
  await world.read();
  await finish(world);
  expect(summary()).toMatchObject({ counts: { unflagged: 2, timedOut: 0 }, unflagged: ['1101', '1102'], screens: 0 });
  expect(world.clock.sleeps).toEqual([]);
});

it('未解決と unflagged は全件数を数え詳細をそれぞれ 50 件に制限する', async () => {
  const pending = collectVisible()[1];
  const world = collectorWorld();
  const items = Array.from({ length: 60 }, (_, i) => ({ ...pending, tweetId: `${2000 + i}` }));
  const unflagged = Array.from({ length: 60 }, (_, i) => ({ ...pending, tweetId: `${3000 + i}`, avatarPending: undefined, mediaPending: undefined }));
  (world.collector as any).d.visible = () => [...items, ...unflagged];
  await world.read();
  await finish(world);
  const log = summary();
  expect(log.counts).toMatchObject({ timedOut: 60, unflagged: 60 });
  expect(log.unresolved).toHaveLength(50);
  expect(log.unflagged).toHaveLength(50);
  expect(log.screens).toBe(1);
});

it('複数画面を数えてもログは終了時だけで本文・名前・ハンドル・URLを出さない', async () => {
  const world = collectorWorld();
  await world.read();
  const pending = collectVisible()[1];
  (world.collector as any).d.visible = () => [{ ...pending, tweetId: '1104' }];
  await world.read();
  expect(info).not.toHaveBeenCalled();
  await finish(world);
  expect(summary().screens).toBe(2);
  const serialized = JSON.stringify(summary());
  for (const value of ['Sample', '@sample_', '架空', 'author', 'handle', 'snapshot', 'https://']) {
    expect(serialized).not.toContain(value);
  }
  await world.collector.stop();
  expect(info).toHaveBeenCalledTimes(1);
});

it('一時停止後の再開は出力せず新しい開始で件数と出力をリセットする', async () => {
  const world = collectorWorld();
  Object.assign((world.collector as any).d, {
    pageOk: () => true, isHidden: () => false, accountId: () => 'me', scrollToTop: () => {},
  });
  await world.read();
  await world.collector.pause();
  const first = summary();
  vi.spyOn(world.collector as any, 'loop').mockResolvedValue(undefined);
  await world.collector.resume();
  await world.collector.stop();
  expect(info).toHaveBeenCalledTimes(1);
  expect(await world.collector.start({ consent: true, accountId: 'me' })).toBe(true);
  await world.collector.stop();
  expect(info).toHaveBeenCalledTimes(2);
  expect(info.mock.calls[1][1]).toMatchObject({ counts: { timedOut: 0 }, screens: 0, unresolved: [] });
  expect(first.counts.timedOut).toBe(1);
});

it('保存失敗で終わる場合も終了ログを一度だけ出す', async () => {
  const world = collectorWorld();
  (world.collector as any).d.addCollected = vi.fn().mockRejectedValue(new Error('架空の保存失敗'));
  await world.read();
  await finish(world);
  expect(world.collector.state!.failed).toBe(2);
  expect(summary().counts.timedOut).toBe(1);
});

it('status リンクの ID を完全一致で確認し写真リンクも残存とみなす', () => {
  expect(hasTweetStatusLink(document, '1102')).toBe(true);
  expect(hasTweetStatusLink(document, '110')).toBe(false);
  document.getElementById('main-post')!.remove();
  expect(hasTweetStatusLink(document, '1102')).toBe(false);
  const template = document.getElementById('late-photo') as HTMLTemplateElement;
  document.body.append(template.content.cloneNode(true));
  expect(hasTweetStatusLink(document, '1102')).toBe(true);
});
