// 版: v75
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { collectVisible, dropSavedCache, refreshCollectButton, unsavedItems } from '../src/content/collect';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import * as snapshot from '../src/content/snapshot';
import * as storage from '../src/shared/storage';
import * as settings from '../src/shared/settings';
import { t } from '../src/shared/strings';
import { installChromeMock } from './chrome-mock';

beforeEach(() => {
  installChromeMock();
  resetAccount();
  setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
  dropSavedCache();
  document.body.innerHTML = readFileSync('test/fixtures/content-read-ids.html', 'utf8');
  const button = document.createElement('button');
  button.className = 'postshelf-collect';
  document.body.append(button);
});
afterEach(() => vi.restoreAllMocks());

const savedCases = [{ saved: [] }, { saved: ['7502'] }, { saved: ['7501', '7502'] }];
it.each(savedCases)('重複と読めない ID を除いた従来の件数を保つ: $saved', async ({ saved }) => {
  const savedIds = new Set(saved);
  const expected = unsavedItems(collectVisible(), savedIds).length;
  vi.spyOn(storage, 'getSavedIds').mockResolvedValue(savedIds);
  const record = vi.spyOn(settings, 'recordPending').mockResolvedValue();
  const extract = vi.spyOn(snapshot, 'extractTweet');
  await refreshCollectButton();
  const button = document.querySelector<HTMLButtonElement>('.postshelf-collect')!;
  expect(button.dataset.pending).toBe(String(expected));
  expect(button.textContent).toBe(expected > 0 ? t('collectPending', expected) : t('collectAllDone'));
  expect(button.disabled).toBe(expected === 0);
  expect(record).toHaveBeenCalledExactlyOnceWith('me', expected);
  expect(extract).not.toHaveBeenCalled();
});

it('保存済み ID の読み込み前に見えていた記事を数える', async () => {
  let finish!: (ids: Set<string>) => void;
  vi.spyOn(storage, 'getSavedIds').mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const record = vi.spyOn(settings, 'recordPending').mockResolvedValue();
  const extract = vi.spyOn(snapshot, 'extractTweet');
  const refreshing = refreshCollectButton();
  document.getElementById('first-duplicate')!.remove();
  document.getElementById('last-duplicate')!.remove();
  finish(new Set(['7502']));
  await refreshing;
  expect(document.querySelector<HTMLButtonElement>('.postshelf-collect')!.dataset.pending).toBe('1');
  expect(record).toHaveBeenCalledWith('me', 1);
  expect(extract).not.toHaveBeenCalled();
});
