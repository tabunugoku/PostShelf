import { afterEach, expect, it, vi } from 'vitest';
import { watchBody } from '../src/content/domwatch';

const disposers: (() => void)[] = [];
const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

function subscribe(callback: () => void, attributes = false): () => void {
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
