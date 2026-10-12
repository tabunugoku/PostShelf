import { afterEach, expect, it, vi } from 'vitest';
import { collectVisible } from '../src/content/collect';
import * as snapshot from '../src/content/snapshot';
import { listBookmarks, setAccountScope } from '../src/shared/storage';
import { installChromeMock } from './chrome-mock';
import { collectorWorld, loadFixture, markLoaded } from './v50-helpers';

afterEach(() => vi.restoreAllMocks());

it.each(['resolved', 'timedOut', 'removed', 'unreadable'])
('待ちの結果 %s は全件解析と一致し対象だけを再解析する', async (reason) => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  const extract = vi.spyOn(snapshot, 'extractTweet');
  const run = async (all: boolean) => {
    installChromeMock();
    setAccountScope('me');
    loadFixture('v58-autocollect.html');
    const world = collectorWorld((now) => {
      if (reason === 'resolved' && now === 600) {
        const template = document.getElementById('late-avatar') as HTMLTemplateElement;
        document.getElementById('main-avatar')!.append(template.content.cloneNode(true));
        markLoaded(document.getElementById('main-avatar')!.querySelector('img')!);
        document.getElementById('main-text')!.textContent = '架空の読み込み完了。';
      }
      if (reason === 'removed') document.getElementById('main-post')?.remove();
      if (reason === 'unreadable') {
        document.getElementById('main-status')!.setAttribute('href', 'https://x.com/sample_slow/status/1202');
      }
    });
    if (all) (world.collector as any).d.visible = () => collectVisible();
    extract.mockClear();
    info.mockClear();
    await world.read();
    await (world.collector as any).finish();
    return {
      parses: extract.mock.calls.length,
      result: {
        bookmarks: await listBookmarks(), imported: world.collector.state!.imported,
        sleeps: world.clock.sleeps, diagnosis: info.mock.calls[0][1],
      },
    };
  };
  const before = await run(true);
  const after = await run(false);
  expect(after.result).toEqual(before.result);
  expect(after.parses).toBeLessThan(before.parses);
});
