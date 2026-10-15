// 版: v38-c, v75
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';

const observers: FakeResizeObserver[] = [];
let notifyOnObserve = true;
class FakeResizeObserver {
  targets = new Set<Element>();
  observe = vi.fn((el: Element) => {
    this.targets.add(el);
    if (!notifyOnObserve) return;
    // 初回の通知も observe の呼び出し中には送らない。
    queueMicrotask(() => {
      if (this.targets.has(el)) this.fire(el);
    });
  });
  unobserve = vi.fn((el: Element) => { this.targets.delete(el); });
  constructor(public cb: ResizeObserverCallback) { observers.push(this); }
  fire(el: Element) { this.cb([{ target: el } as ResizeObserverEntry], this as unknown as ResizeObserver); }
}
function article(bookmarkTag: 'button' | 'span' = 'button') {
  // 大きさ用の最小 fixture。丸の構造の想定は v35〜v37 の fixtures と同じ。
  const el = document.createElement('article');
  el.dataset.testid = 'tweet';
  el.innerHTML = `<${bookmarkTag} data-testid="bookmark"><div><svg></svg></div></${bookmarkTag}>`;
  document.body.append(el);
  return el;
}
beforeEach(() => {
  vi.resetModules();
  installChromeMock();
  observers.length = 0;
  notifyOnObserve = true;
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
  await Promise.resolve();
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

it('最初の通知が無いインライン要素でも挿入直後に 42px・26px にする', async () => {
  notifyOnObserve = false;
  const selectors = await import('../src/shared/selectors');
  const read = vi.spyOn(selectors, 'bookmarkButtonGeometry');
  const { injectButtons } = await import('../src/content/buttons');
  // 初回通知を受けないインライン要素を、最小 fixture で再現する。
  const el = article('span');
  vi.spyOn(el.querySelector('svg')!, 'getBoundingClientRect')
    .mockReturnValue({ height: 26, width: 26 } as DOMRect);
  injectButtons();
  const bm = el.querySelector<HTMLElement>('[data-testid="bookmark"]')!;
  const btn = el.querySelector<HTMLElement>('[data-postshelf-btn]')!;
  expect(observers[0].targets.has(bm)).toBe(true);
  expect(read).toHaveBeenCalledExactlyOnceWith(bm);
  expect([btn.style.width, btn.style.height, btn.style.fontSize]).toEqual(['42px', '42px', '26px']);
  await Promise.resolve();
  injectButtons();
  expect(read).toHaveBeenCalledTimes(1);
  expect([btn.style.width, btn.style.height, btn.style.fontSize]).toEqual(['42px', '42px', '26px']);
});

it.each([true, false])('全件挿入して測定してから寸法を反映する (ResizeObserver: %s)', async (hasObserver) => {
  notifyOnObserve = false;
  if (!hasObserver) vi.stubGlobal('ResizeObserver', undefined);
  const { injectButtons } = await import('../src/content/buttons');
  const articles = [article(), article()];
  const events: string[] = [];
  const insert = HTMLElement.prototype.insertAdjacentElement;
  vi.spyOn(HTMLElement.prototype, 'insertAdjacentElement')
    .mockImplementation(function (this: HTMLElement, position, element) {
      const result = insert.call(this, position, element);
      events.push('insert');
      return result;
    });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    events.push('read');
    const buttons = document.querySelectorAll<HTMLElement>('[data-postshelf-btn]');
    expect(buttons).toHaveLength(2);
    // 最後の測定まで、新規ボタンの寸法を書き換えない。
    expect([...buttons].map((btn) => [btn.style.height, btn.style.fontSize]))
      .toEqual([['34px', '19px'], ['34px', '19px']]);
    const size = this.tagName === 'svg' ? 26 : 0;
    return { height: size, width: size } as DOMRect;
  });
  injectButtons();
  expect(events).toEqual(['insert', 'insert', 'read', 'read', 'read', 'read']);
  const buttons = articles.map((el) => el.querySelector<HTMLElement>('[data-postshelf-btn]')!);
  expect(buttons.map((btn) => [btn.style.width, btn.style.height, btn.style.fontSize]))
    .toEqual([['42px', '42px', '26px'], ['42px', '42px', '26px']]);
});

it('通知内の全記事を測ってから寸法をまとめて反映する', async () => {
  const selectors = await import('../src/shared/selectors');
  const read = vi.spyOn(selectors, 'bookmarkButtonGeometry')
    .mockReturnValue({ iconHeight: 26, circleDiameter: 0 });
  const { injectButtons } = await import('../src/content/buttons');
  const articles = [article(), article()];
  injectButtons();
  await Promise.resolve();
  const buttons = articles.map((el) => el.querySelector<HTMLElement>('[data-postshelf-btn]')!);
  read.mockClear();
  read.mockImplementation(() => {
    expect(buttons.map((btn) => btn.style.height)).toEqual(['42px', '42px']);
    return { iconHeight: 30, circleDiameter: 0 };
  });
  const ro = observers[0];
  const entries = articles.map((el) => ({
    target: el.querySelector('button')!,
  } as unknown as ResizeObserverEntry));
  ro.cb(entries, ro as unknown as ResizeObserver);
  expect(read).toHaveBeenCalledTimes(2);
  expect(buttons.map((btn) => [btn.style.width, btn.style.height, btn.style.fontSize]))
    .toEqual([['46px', '46px', '30px'], ['46px', '46px', '30px']]);
});
