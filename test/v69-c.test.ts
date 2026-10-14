import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetHealth } from '../src/content/health';
import { handleMessage } from '../src/content/messages';
import { installChromeMock } from './chrome-mock';

const ask = (msg: Parameters<typeof handleMessage>[0]) =>
  new Promise<any>((resolve) => {
    handleMessage(msg, resolve);
  });

beforeEach(() => {
  installChromeMock();
  resetHealth();
  document.body.innerHTML = '';
});

describe('v69-C: x.com の content script は、設定を読めなくても問い合わせに応答する', () => {
  it('getSettings が失敗しても syncNative に応答する', async () => {
    vi.spyOn(chrome.storage.local, 'get').mockRejectedValue(Error('storage'));
    expect(await ask({ type: 'syncNative', tweetId: '1', want: true })).toEqual({ ok: false });
  });

  it('getHealth が失敗しても getDiagnostics に、health 不明の報告で応答する', async () => {
    vi.spyOn(chrome.storage.local, 'get').mockRejectedValue(Error('storage'));
    const res = await ask({ type: 'getDiagnostics' });
    expect(res.ok).toBe(true);
    expect(res.report).toContain('health: unknown');
  });
});
