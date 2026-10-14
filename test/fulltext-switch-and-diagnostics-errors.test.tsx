// 版: v68-f
import { act } from 'preact/test-utils';
import { render } from 'preact';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { FullTextSection } from '../src/manager/FullText';
import { DiagnosticsDialog } from '../src/manager/Diagnostics';
import { SavedContext } from '../src/manager/settingsSaved';
import { clearStorageError } from '../src/manager/errorBus';

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 30)));
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;

beforeEach(() => {
  installChromeMock();
  clearStorageError();
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  act(() => render(null, $('#app')));
  vi.restoreAllMocks();
  clearStorageError();
});

describe('設定の全文のスイッチ', () => {
  it('保存に失敗したら、スイッチのチェックが保存値に戻る', async () => {
    await act(() => render(<SavedContext.Provider value={() => {}}><FullTextSection /></SavedContext.Provider>, $('#app')));
    await flush();
    expect($<HTMLInputElement>('.full-text input[role=switch]').checked).toBe(true);
    vi.spyOn(chrome.storage.local, 'set').mockRejectedValue(new Error('storage'));
    await act(() => void $<HTMLInputElement>('.full-text input[role=switch]').click());
    await flush();
    expect($<HTMLInputElement>('.full-text input[role=switch]').checked).toBe(true);
  });
});

describe('診断情報', () => {
  it('x.com のタブが無く health を読めなくても、報告が表示されてコピーできる', async () => {
    (globalThis as any).chrome.runtime = { getManifest: () => ({ version: '9.9.9' }) };
    (globalThis as any).chrome.tabs = { query: async () => [] };
    vi.spyOn(chrome.storage.local, 'get').mockRejectedValue(new Error('storage'));
    await act(() => void render(<DiagnosticsDialog onClose={() => {}} />, $('#app')));
    await flush();
    expect($('.diag-pre').textContent).toContain('PostShelf 9.9.9');
    expect($('.diag-pre').textContent).toContain('health: unknown');
    expect($<HTMLButtonElement>('.primary').disabled).toBe(false);
  });
});
