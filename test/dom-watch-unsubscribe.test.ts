// 版: v62-c
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ownPostLink, queryAllFirst, queryFirst } from '../src/shared/selectors';
import { watchBody } from '../src/content/domwatch';

const disposers: (() => void)[] = [];
const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

function subscribe(callback: () => void, attributes: boolean | readonly string[] = false): () => void {
  const dispose = watchBody(callback, attributes);
  disposers.push(dispose);
  return dispose;
}

afterEach(() => {
  // 修正前の失敗確認でも、未実装の解除関数で後片付けを失敗させない。
  for (const dispose of disposers.splice(0)) {
    if (typeof dispose === 'function') dispose();
  }
  vi.restoreAllMocks();
});

it('解除した購読者には通知せず、残った購読者には通知する', async () => {
  const removed = vi.fn();
  const remaining = vi.fn();
  const off = subscribe(removed);
  subscribe(remaining);
  expect(typeof off).toBe('function');
  off();
  document.body.append(document.createElement('div'));
  await flush();
  expect(removed).not.toHaveBeenCalled();
  expect(remaining).toHaveBeenCalledOnce();
});

it('最後の解除で切断し、次の登録では新しい observer が再び動く', async () => {
  const observe = vi.spyOn(MutationObserver.prototype, 'observe');
  const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
  const first = subscribe(vi.fn());
  const second = subscribe(vi.fn());
  expect(observe).toHaveBeenCalledOnce();
  expect(typeof first).toBe('function');
  first();
  expect(disconnect).not.toHaveBeenCalled();
  second();
  expect(disconnect).toHaveBeenCalledOnce();
  const resumed = vi.fn();
  subscribe(resumed);
  expect(observe).toHaveBeenCalledTimes(2);
  expect(observe.mock.instances[1]).not.toBe(observe.mock.instances[0]);
  // 古い解除関数をもう一度呼んでも、再開した監視は止まらない。
  first();
  document.body.append(document.createElement('div'));
  await flush();
  expect(resumed).toHaveBeenCalledOnce();
});

it('解除後に登録し直した購読者も登録順に通知する', async () => {
  const events: string[] = [];
  subscribe(() => events.push('first'));
  const middle = subscribe(() => events.push('middle'));
  subscribe(() => events.push('last'));
  expect(typeof middle).toBe('function');
  middle();
  subscribe(() => events.push('resumed'));
  document.body.append(document.createElement('div'));
  await flush();
  expect(events).toEqual(['first', 'last', 'resumed']);
});

it('属性だけの変更は希望した購読者だけに通知する', async () => {
  const img = document.createElement('img');
  document.body.replaceChildren(img);
  const children = vi.fn();
  const attributes = vi.fn();
  const off = subscribe(children);
  subscribe(attributes, true);
  expect(typeof off).toBe('function');
  img.setAttribute('src', 'sample.png');
  await flush();
  expect(children).not.toHaveBeenCalled();
  expect(attributes).toHaveBeenCalledOnce();
  img.setAttribute('class', 'sample');
  await flush();
  expect(attributes).toHaveBeenCalledOnce();
});

it.each([
  ['href', [1, 0, 0]],
  ['src', [0, 1, 0]],
  ['poster', [0, 1, 0]],
  ['class', [0, 0, 0]],
] as const)('属性名に応じた購読者だけに通知する: %s', async (attributeName, counts) => {
  document.body.innerHTML = readFileSync('test/fixtures/v56-visible.html', 'utf8');
  const article = queryAllFirst(document, 'tweet').els[0];
  const link = ownPostLink(article).link!;
  const image = queryFirst(article, 'avatar')!.el;
  const callbacks = [vi.fn(), vi.fn(), vi.fn()];
  subscribe(callbacks[0], ['href']);
  subscribe(callbacks[1], true);
  subscribe(callbacks[2], false);

  const target = attributeName === 'href' ? link : image;
  target.setAttribute(attributeName, attributeName === 'href' ? '/sample_user/status/2' : 'sample.png');
  await flush();
  callbacks.forEach((callback, index) => expect(callback).toHaveBeenCalledTimes(counts[index]));
});

it('子要素と複数の属性が同時に変わっても全購読者へ 1 回ずつ通知する', async () => {
  document.body.innerHTML = readFileSync('test/fixtures/v56-visible.html', 'utf8');
  const article = queryAllFirst(document, 'tweet').els[0];
  const callbacks = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
  subscribe(callbacks[0], ['href']);
  subscribe(callbacks[1], true);
  subscribe(callbacks[2], false);
  subscribe(callbacks[3], []);

  ownPostLink(article).link!.setAttribute('href', '/sample_user/status/2');
  const image = queryFirst(article, 'avatar')!.el;
  image.setAttribute('src', 'sample.png');
  image.setAttribute('poster', 'sample-poster.png');
  article.append(document.createElement('span'));
  await flush();
  callbacks.forEach((callback) => expect(callback).toHaveBeenCalledOnce());
});

it('複数の属性名を指定しても同じ通知では 1 回だけ呼ぶ', async () => {
  const target = document.createElement('div');
  document.body.replaceChildren(target);
  const callback = vi.fn();
  subscribe(callback, ['href', 'src']);
  target.setAttribute('href', '/sample_user/status/2');
  target.setAttribute('src', 'sample.png');
  await flush();
  expect(callback).toHaveBeenCalledOnce();
});
