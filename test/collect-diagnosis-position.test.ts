// 版: v61-d
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { collectorWorld, loadFixture } from './collector-helpers';
import { installChromeMock } from './chrome-mock';
import { setAccountScope } from '../src/shared/storage';

beforeEach(() => {
  installChromeMock();
  setAccountScope('me');
  loadFixture('v58-autocollect.html');
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

it('savedIds の待ち中に別の visible が走っても最初の診断位置を保つ', async () => {
  const world = collectorWorld();
  const collector = world.collector as any;
  let resolveSaved!: (ids: Set<string>) => void;
  collector.d.savedIds = () => new Promise<Set<string>>((resolve) => { resolveSaved = resolve; });
  const read = world.read();
  document.getElementById('first-post')!.remove();
  collector.d.visible();
  expect(collector.d.visiblePosition('1202')).toBe(1);
  resolveSaved(new Set());
  await read;
  await collector.finish();
  expect(vi.mocked(console.info).mock.calls[0][1].unresolved[0]).toMatchObject({ position: 2 });
});

it('時間切れの補完を待つ間に別の visible が走っても最初の診断位置を保つ', async () => {
  const world = collectorWorld();
  const collector = world.collector as any;
  collector.saved = new Set(['1203']);
  collector.timedOut.add('1203');
  let resolveFill!: (count: number) => void;
  collector.d.fillMissing = () => new Promise<number>((resolve) => { resolveFill = resolve; });
  const read = world.read();
  document.getElementById('first-post')!.remove();
  collector.d.visible();
  resolveFill(1);
  await read;
  await collector.finish();
  expect(vi.mocked(console.info).mock.calls[0][1].unresolved[0]).toMatchObject({ position: 2 });
});

it('visiblePosition のないスタブでは取得した列の位置を使う', async () => {
  const world = collectorWorld();
  (world.collector as any).d.visiblePosition = undefined;
  await world.read();
  await (world.collector as any).finish();
  expect(vi.mocked(console.info).mock.calls[0][1].unresolved[0]).toMatchObject({ position: 2 });
});
