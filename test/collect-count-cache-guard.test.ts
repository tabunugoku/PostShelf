// 版: v80
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock, installPanelMock } from './chrome-mock';

let collect: typeof import('../src/content/collect');
let storage: typeof import('../src/shared/storage');
let settings: typeof import('../src/shared/settings');
let account: typeof import('../src/content/account');
let stop: (() => void) | undefined;
const button = () => document.querySelector<HTMLButtonElement>('.postshelf-collect')!;
const allSaved = () => new Set(['7501', '7502']);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(0);
  installChromeMock();
  installPanelMock();
  history.replaceState({}, '', '/i/history');
  document.body.innerHTML = readFileSync('test/fixtures/content-read-ids.html', 'utf8');
  const element = document.createElement('button');
  element.className = 'postshelf-collect';
  element.textContent = 'sample initial';
  document.body.append(element);
  storage = await import('../src/shared/storage');
  vi.spyOn(storage, 'getSavedIds').mockResolvedValue(new Set(['7502']));
  settings = await import('../src/shared/settings');
  vi.spyOn(settings, 'recordPending').mockResolvedValue();
  vi.spyOn(settings, 'getSettings').mockResolvedValue(settings.DEFAULT_SETTINGS);
  account = await import('../src/content/account');
  account.setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
  collect = await import('../src/content/collect');
});

afterEach(() => {
  stop?.();
  stop = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('DOM の変化が続いても 30 秒未満は ID を使い回し、30 秒で読み直す', async () => {
  await collect.refreshCollectButton();
  for (let index = 0; index < 4; index++) {
    document.body.append(document.createElement('span'));
    collect.scheduleCollectRefresh();
    await vi.advanceTimersByTimeAsync(1000);
  }
  expect(storage.getSavedIds).toHaveBeenCalledTimes(1);
  expect(settings.recordPending).toHaveBeenCalledTimes(5);
  await vi.advanceTimersByTimeAsync(29_999 - Date.now());
  await collect.refreshCollectButton();
  expect(storage.getSavedIds).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await collect.refreshCollectButton();
  expect(storage.getSavedIds).toHaveBeenCalledTimes(2);
  expect(button().dataset.pending).toBe('1');
});

it('保存通知で 30 秒未満でも読み直して件数と案内を更新する', async () => {
  stop = collect.watchCollectData();
  await collect.refreshCollectButton();
  vi.mocked(storage.getSavedIds).mockResolvedValue(allSaved());
  await chrome.storage.local.set({ bookmarks: {} });
  await vi.advanceTimersByTimeAsync(0);
  expect(storage.getSavedIds).toHaveBeenCalledTimes(2);
  expect(button().dataset.pending).toBe('0');
  expect(button().textContent).toBe(chrome.i18n.getMessage('collectAllDone'));
  expect(settings.recordPending).toHaveBeenLastCalledWith('me', 0);
});

it('アカウント切替で 30 秒未満でも読み直し、戻った場合も前のキャッシュを使わない', async () => {
  stop = collect.watchCollectData();
  await collect.refreshCollectButton();
  vi.mocked(storage.getSavedIds).mockResolvedValue(allSaved());
  account.setCurrentAccount({ id: 'sample_other', handle: 'sample_other', lastSeenAt: 0 });
  await vi.advanceTimersByTimeAsync(0);
  expect(button().dataset.pending).toBe('0');
  expect(settings.recordPending).toHaveBeenLastCalledWith('sample_other', 0);
  vi.mocked(storage.getSavedIds).mockResolvedValue(new Set());
  account.setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.mocked(storage.getSavedIds).mock.calls).toEqual([['me'], ['sample_other'], ['me']]);
  expect(button().dataset.pending).toBe('2');
  expect(settings.recordPending).toHaveBeenLastCalledWith('me', 2);
});

it('取り込みボタンの保存でキャッシュを破棄し、3 秒後に新しい件数を出す', async () => {
  button().remove();
  vi.spyOn(storage, 'addCollected').mockImplementation(async () => {
    vi.mocked(storage.getSavedIds).mockResolvedValue(allSaved());
    return 1;
  });
  collect.ensureCollectButton();
  await vi.advanceTimersByTimeAsync(0);
  expect(button().dataset.pending).toBe('1');
  button().click();
  await vi.advanceTimersByTimeAsync(0);
  expect(button().textContent).toBe(chrome.i18n.getMessage('collectDone', ['1']));
  expect(storage.addCollected).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(2999);
  expect(storage.getSavedIds).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(storage.getSavedIds).toHaveBeenCalledTimes(3);
  expect(button().dataset.pending).toBe('0');
  expect(settings.recordPending).toHaveBeenLastCalledWith('me', 0);
});

it('同じ読み出しを待つ更新では、最後に観測した DOM の件数だけを書く', async () => {
  const reading = deferred<Set<string>>();
  vi.mocked(storage.getSavedIds).mockReturnValue(reading.promise);
  const first = collect.refreshCollectButton();
  document.getElementById('first-duplicate')!.remove();
  document.getElementById('last-duplicate')!.remove();
  const second = collect.refreshCollectButton();
  reading.resolve(new Set());
  await Promise.all([first, second]);
  expect(storage.getSavedIds).toHaveBeenCalledTimes(1);
  expect(button().dataset.pending).toBe('1');
  expect(settings.recordPending).toHaveBeenCalledExactlyOnceWith('me', 1);
});

it.each(['before', 'after'])('古い読み出しが新しい結果の %s に完了しても古い件数を書かない', async (order) => {
  const old = deferred<Set<string>>();
  const fresh = deferred<Set<string>>();
  vi.mocked(storage.getSavedIds).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const first = collect.refreshCollectButton();
  collect.dropSavedCache();
  const second = collect.refreshCollectButton();
  if (order === 'before') {
    old.resolve(new Set());
    await first;
    expect(button().textContent).toBe('sample initial');
    expect(settings.recordPending).not.toHaveBeenCalled();
  }
  fresh.resolve(allSaved());
  await second;
  if (order === 'after') {
    old.resolve(new Set());
    await first;
  }
  expect(button().dataset.pending).toBe('0');
  expect(settings.recordPending).toHaveBeenCalledExactlyOnceWith('me', 0);
  await collect.refreshCollectButton();
  expect(storage.getSavedIds).toHaveBeenCalledTimes(2);
  expect(button().dataset.pending).toBe('0');
});

it('待機中に破棄されただけでも古い件数を書かず、次の更新で読み直す', async () => {
  const old = deferred<Set<string>>();
  vi.mocked(storage.getSavedIds).mockReturnValueOnce(old.promise).mockResolvedValue(allSaved());
  const updating = collect.refreshCollectButton();
  collect.dropSavedCache();
  old.resolve(new Set());
  await updating;
  expect(button().textContent).toBe('sample initial');
  expect(settings.recordPending).not.toHaveBeenCalled();
  await collect.refreshCollectButton();
  expect(storage.getSavedIds).toHaveBeenCalledTimes(2);
  expect(button().dataset.pending).toBe('0');
});

it('読み込み中の保存通知とアカウント切替が重なっても最後のアカウントの結果だけを書く', async () => {
  const old = deferred<Set<string>>();
  const intermediate = deferred<Set<string>>();
  const fresh = deferred<Set<string>>();
  const read = vi.mocked(storage.getSavedIds)
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(intermediate.promise)
    .mockReturnValueOnce(fresh.promise);
  stop = collect.watchCollectData();
  const first = collect.refreshCollectButton();
  await chrome.storage.local.set({ bookmarks: {} });
  account.setCurrentAccount({ id: 'sample_other', handle: 'sample_other', lastSeenAt: 0 });
  fresh.resolve(allSaved());
  await vi.advanceTimersByTimeAsync(0);
  intermediate.resolve(new Set());
  old.resolve(new Set());
  await first;
  await vi.advanceTimersByTimeAsync(0);
  expect(read.mock.calls).toEqual([['me'], ['me'], ['sample_other']]);
  expect(button().dataset.pending).toBe('0');
  expect(settings.recordPending).toHaveBeenCalledExactlyOnceWith('sample_other', 0);
  await collect.refreshCollectButton();
  expect(read).toHaveBeenCalledTimes(3);
});

it('読み出しが失敗したら次の更新で読み直す', async () => {
  vi.mocked(storage.getSavedIds).mockRejectedValueOnce(new Error('sample failure'));
  await expect(collect.refreshCollectButton()).rejects.toThrow('sample failure');
  expect(settings.recordPending).not.toHaveBeenCalled();
  await collect.refreshCollectButton();
  expect(storage.getSavedIds).toHaveBeenCalledTimes(2);
  expect(button().dataset.pending).toBe('1');
});

it('破棄した読み出しの失敗で新しいキャッシュを消さない', async () => {
  const old = deferred<Set<string>>();
  vi.mocked(storage.getSavedIds).mockReturnValueOnce(old.promise).mockResolvedValue(allSaved());
  const first = collect.refreshCollectButton();
  const failed = expect(first).rejects.toThrow('sample failure');
  collect.dropSavedCache();
  await collect.refreshCollectButton();
  old.reject(new Error('sample failure'));
  await failed;
  await collect.refreshCollectButton();
  expect(storage.getSavedIds).toHaveBeenCalledTimes(2);
  expect(button().dataset.pending).toBe('0');
});

it('アカウント不明の表示を保ち、待機中だった同じアカウントの結果も書かない', async () => {
  const old = deferred<Set<string>>();
  vi.mocked(storage.getSavedIds).mockReturnValueOnce(old.promise);
  const first = collect.refreshCollectButton();
  account.setCurrentAccount(null);
  await collect.refreshCollectButton();
  expect(button().textContent).toBe(chrome.i18n.getMessage('collectNoAccount'));
  expect(button().dataset.pending).toBe('0');
  expect(button().disabled).toBe(true);
  expect(button().title).toBe(chrome.i18n.getMessage('accountUnknown'));
  // 待機中に元のアカウントへ戻っても、より後の不明表示の更新を優先する。
  account.setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
  old.resolve(new Set());
  await first;
  expect(button().textContent).toBe(chrome.i18n.getMessage('collectNoAccount'));
  expect(settings.recordPending).not.toHaveBeenCalled();
  expect(storage.getSavedIds).toHaveBeenCalledTimes(1);
});

it('完了表示中の通知と、完了表示より前に始まった読み出しでは表示を上書きしない', async () => {
  button().remove();
  vi.spyOn(storage, 'addCollected').mockResolvedValue(1);
  collect.ensureCollectButton();
  await vi.advanceTimersByTimeAsync(0);
  stop = collect.watchCollectData();
  const old = deferred<Set<string>>();
  collect.dropSavedCache();
  vi.mocked(storage.getSavedIds).mockReturnValueOnce(old.promise).mockResolvedValue(allSaved());
  const updating = collect.refreshCollectButton();
  const record = vi.mocked(settings.recordPending).mockClear();
  button().click();
  await vi.advanceTimersByTimeAsync(0);
  const message = chrome.i18n.getMessage('collectDone', ['1']);
  expect(button().textContent).toBe(message);
  await chrome.storage.local.set({ bookmarks: {} });
  old.resolve(new Set());
  await updating;
  await vi.advanceTimersByTimeAsync(2999);
  expect(button().textContent).toBe(message);
  expect(record).not.toHaveBeenCalled();
  expect(storage.getSavedIds).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(1);
  expect(storage.getSavedIds).toHaveBeenCalledTimes(4);
  expect(button().dataset.pending).toBe('0');
  expect(record).toHaveBeenCalledExactlyOnceWith('me', 0);
});

it('読み出し待ちの間に取り込みが始まった場合も案内件数を書かない', async () => {
  button().remove();
  collect.ensureCollectButton();
  await vi.advanceTimersByTimeAsync(0);
  const saving = deferred<number>();
  vi.spyOn(storage, 'addCollected').mockReturnValue(saving.promise);
  const old = deferred<Set<string>>();
  collect.dropSavedCache();
  vi.mocked(storage.getSavedIds).mockReturnValueOnce(old.promise).mockResolvedValue(allSaved());
  const updating = collect.refreshCollectButton();
  vi.mocked(settings.recordPending).mockClear();
  button().click();
  await vi.advanceTimersByTimeAsync(0);
  old.resolve(new Set());
  await updating;
  expect(settings.recordPending).not.toHaveBeenCalled();
  saving.resolve(1);
  await vi.advanceTimersByTimeAsync(3000);
  expect(button().dataset.pending).toBe('0');
  expect(settings.recordPending).toHaveBeenCalledExactlyOnceWith('me', 0);
});

it('見えていないタブでも通知で件数を更新し、可視化を待たない', async () => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  stop = collect.watchCollectData();
  await collect.refreshCollectButton();
  vi.mocked(storage.getSavedIds).mockResolvedValue(allSaved());
  await chrome.storage.local.set({ bookmarks: {} });
  await vi.advanceTimersByTimeAsync(0);
  expect(storage.getSavedIds).toHaveBeenCalledTimes(2);
  expect(button().dataset.pending).toBe('0');
  expect(settings.recordPending).toHaveBeenLastCalledWith('me', 0);
});
