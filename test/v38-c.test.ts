import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';

const observers: FakeResizeObserver[] = [];
class FakeResizeObserver {
  targets = new Set<Element>();
  observe = vi.fn((el: Element) => { this.targets.add(el); });
  unobserve = vi.fn((el: Element) => { this.targets.delete(el); });
  constructor(public cb: ResizeObserverCallback) { observers.push(this); }
  fire(el: Element) { this.cb([{ target: el } as ResizeObserverEntry], this as unknown as ResizeObserver); }
}
function article() {
  // 大きさ用の最小 fixture。丸の構造の想定は v35〜v37 の fixtures と同じ。
  const el = document.createElement('article');
  el.dataset.testid = 'tweet';
  el.innerHTML = '<button data-testid="bookmark"><div><svg></svg></div></button>';
  document.body.append(el);
  return el;
}
beforeEach(() => {
  vi.resetModules();
  installChromeMock();
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  document.body.innerHTML = '';
});
afterEach(() => {
  document.body.innerHTML = '';
  for (const ro of observers) for (const target of [...ro.targets]) ro.fire(target);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('shares one observer and unobserves detached bookmarks on resize notifications without a mutation observer', async () => {
  const Mutation = globalThis.MutationObserver;
  const mutations = vi.fn();
  vi.stubGlobal('MutationObserver', class extends Mutation {
    constructor(cb: MutationCallback) { super(cb); mutations(); }
  });
  const { injectButtons } = await import('../src/content/buttons');
  const first = article();
  const second = article();
  injectButtons();
  expect(observers).toHaveLength(1);
  expect(mutations).not.toHaveBeenCalled();
  const ro = observers[0];
  expect(ro.targets.size).toBe(2);
  const removedBm = first.querySelector('button')!;
  first.remove();
  ro.fire(removedBm); // jsdom は ResizeObserver を実装しないので、取り外し時の通知を再現する
  expect(ro.unobserve).toHaveBeenCalledWith(removedBm);
  expect(ro.targets.has(removedBm)).toBe(false);
  expect(ro.targets.has(second.querySelector('button')!)).toBe(true);
  for (let i = 0; i < 5; i++) {
    const replacement = article();
    const replacementBm = replacement.querySelector('button')!;
    injectButtons();
    expect(ro.targets.size).toBe(2);
    replacement.remove();
    ro.fire(replacementBm);
    expect(ro.unobserve).toHaveBeenCalledWith(replacementBm);
    expect(ro.targets.size).toBe(1);
  }
  expect(observers).toHaveLength(1);
});

it('resizes the mapped button, unobserves immediately on mode changes, and handles notifications with a detached folder button', async () => {
  const { injectButtons, applyButtonMode } = await import('../src/content/buttons');
  const el = article();
  let height = 22;
  el.querySelector('svg')!.getBoundingClientRect = () => ({ height, width: height } as DOMRect);
  injectButtons();
  const ro = observers[0];
  const bm = el.querySelector('button')!;
  const btn = el.querySelector<HTMLElement>('[data-postshelf-btn]')!;
  height = 26;
  ro.fire(bm);
  expect(btn.style.height).toBe('42px');
  applyButtonMode('replace');
  expect(ro.unobserve).toHaveBeenCalledWith(bm);
  expect(ro.targets.size).toBe(0);
  applyButtonMode('separate');
  expect(observers).toHaveLength(1);
  expect(ro.targets.size).toBe(1);
  const replacementBtn = el.querySelector<HTMLElement>('[data-postshelf-btn]')!;
  replacementBtn.remove();
  height = 30;
  ro.fire(bm);
  expect(ro.targets.size).toBe(0);
  height = 34;
  ro.fire(bm); // 解除済みの遅れて届く通知も無視する
  expect(replacementBtn.style.height).toBe('42px');
});

it('reads X button geometry through shared selectors', async () => {
  const selectors = await import('../src/shared/selectors');
  const read = vi.spyOn(selectors, 'bookmarkButtonGeometry').mockReturnValue({ iconHeight: 26, circleDiameter: 52 });
  const { sizeSeparateButton } = await import('../src/content/buttons');
  const bm = article().querySelector<HTMLButtonElement>('button')!;
  const btn = document.createElement('button');
  sizeSeparateButton(bm, btn);
  expect(read).toHaveBeenCalledWith(bm);
  expect([btn.style.width, btn.style.height, btn.style.fontSize]).toEqual(['52px', '52px', '26px']);
});
