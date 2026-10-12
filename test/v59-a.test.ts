import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { scheduleCollectRefresh } from '../src/content/collect';
import { scheduleMediaBackfill } from '../src/content/media';

vi.mock('../src/content/collect', async (original) => ({
  ...await original<typeof import('../src/content/collect')>(),
  ensureCollectButton: vi.fn(),
  watchCollectData: vi.fn(),
  watchPath: vi.fn(),
  scheduleCollectRefresh: vi.fn(),
}));
vi.mock('../src/content/media', () => ({
  installMediaBackfill: vi.fn(),
  scheduleMediaBackfill: vi.fn(),
}));
vi.mock('../src/content/autocollect', () => ({
  installAutoCollect: vi.fn(() => ({ state: null })),
  handleCollectCommand: vi.fn(),
}));
vi.mock('../src/content/autocollectPanel', () => ({
  AutoCollectPanel: class { update = vi.fn(); },
}));

const observers: { callback: MutationCallback; options?: MutationObserverInit }[] = [];
let events: string[];

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  installChromeMock();
  document.body.innerHTML = '';
  history.replaceState(null, '', '/home');
  observers.length = 0;
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: MutationCallback) {
      observers.push({ callback });
    }
    observe(target: Node, options: MutationObserverInit) {
      expect(target).toBe(document.body);
      observers[observers.length - 1].options = options;
    }
  });
  vi.stubGlobal('requestAnimationFrame', vi.fn());
  await import('../src/content/index');
  await vi.advanceTimersByTimeAsync(0);
  events = [];
  const setTimeout = globalThis.setTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) => {
    events.push(`timer:${delay}`);
    return setTimeout(callback, delay, ...args);
  });
  vi.mocked(requestAnimationFrame).mockImplementation(() => {
    events.push('buttons');
    return 1;
  });
  vi.mocked(scheduleCollectRefresh).mockImplementation(() => events.push('collect'));
  vi.mocked(scheduleMediaBackfill).mockImplementation(() => events.push('media'));
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function deliver(records: MutationRecord[]): void {
  for (const { callback, options } of observers) {
    const accepted = records.filter((record) => record.type === 'childList'
      ? options?.childList
      : options?.attributes && options.attributeFilter?.includes(record.attributeName!));
    if (accepted.length) callback(accepted, {} as MutationObserver);
  }
}

it('body の監視を 1 つだけ作る', () => {
  expect(observers).toHaveLength(1);
  expect(observers[0].options).toEqual({
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'poster'],
  });
});

it('子要素の変化で各購読者を従来の登録順に 1 回ずつ呼ぶ', () => {
  deliver([{ type: 'childList' } as MutationRecord]);
  expect(events).toEqual(['timer:2000', 'timer:10000', 'buttons', 'timer:1200', 'collect', 'media']);
});

it.each(['src', 'poster'])('%s の属性変更は取り込みと画像補完だけへ通知する', (attributeName) => {
  deliver([{ type: 'attributes', attributeName } as MutationRecord]);
  expect(events).toEqual(['collect', 'media']);
});

it('子要素と属性が同じバッチで変わっても各購読者を 1 回だけ呼ぶ', () => {
  deliver([
    { type: 'childList' } as MutationRecord,
    { type: 'attributes', attributeName: 'src' } as MutationRecord,
  ]);
  expect(events).toEqual(['timer:2000', 'timer:10000', 'buttons', 'timer:1200', 'collect', 'media']);
});

it('src と poster 以外の属性変更は通知しない', () => {
  deliver([{ type: 'attributes', attributeName: 'class' } as MutationRecord]);
  expect(events).toEqual([]);
});

it('連続した変化でも各購読者のスロットルとデバウンスを維持する', () => {
  deliver([{ type: 'childList' } as MutationRecord]);
  events.length = 0;
  deliver([{ type: 'childList' } as MutationRecord]);
  expect(events).toEqual(['timer:1200', 'collect', 'media']);
});

it('購読者の例外が後続の通知を止めない', () => {
  const error = new Error('架空の購読者エラー');
  const queued: VoidFunction[] = [];
  vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => queued.push(callback));
  vi.mocked(setTimeout).mockImplementationOnce(() => { throw error; });
  deliver([{ type: 'childList' } as MutationRecord]);
  expect(events).toEqual(['timer:10000', 'buttons', 'timer:1200', 'collect', 'media']);
  expect(queued).toHaveLength(1);
  expect(queued[0]).toThrow(error);
});
