// 版: v72
import { readFileSync } from 'node:fs';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { managerCss } from './css-helpers';
import { closeAutoCollectDialog, dialogTrust, openAutoCollectDialog } from '../src/content/autocollectDialog';
import { ensureCollectButton } from '../src/content/collect';
import { resetAccount, setCurrentAccount } from '../src/content/account';
import { getSettings, peekCollectCommand, updateAutoCollect } from '../src/shared/settings';

const collector = { start: vi.fn(async () => true) };
vi.mock('../src/content/autocollect', async (original) => ({
  ...(await original<typeof import('../src/content/autocollect')>()),
  getCollector: () => collector,
}));

const flush = (ms = 25) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const roots: ShadowRoot[] = [];
const dialog = () => roots[roots.length - 1];
const host = () => document.querySelector('.postshelf-autocollect-dialog');
const inner = <T extends Element>(sel: string) => dialog().querySelector<T>(sel)!;
const innerAll = <T extends Element>(sel: string) => [...dialog().querySelectorAll<T>(sel)];
const startButton = () => inner<HTMLButtonElement>('.dialog-actions .primary');
const consentBox = () => inner<HTMLInputElement>('input[type=checkbox]');
const press = async (key: string) => {
  await flush(); // キーのリスナーは、描画のあとの effect で付く
  await act(() => void inner('.ac-dialog').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true })));
};

const original = Element.prototype.attachShadow;
let sendMessage: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  installChromeMock();
  sendMessage = vi.fn(async () => {});
  (globalThis as any).chrome.runtime.sendMessage = sendMessage;
  collector.start.mockClear();
  roots.length = 0;
  // 閉じた shadow root は外から読めないので、テストの間だけ、作られた root を控える (開発側のコードは closed のまま)
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
    expect(init.mode).toBe('closed');
    const root = original.call(this, { ...init, mode: 'open' });
    roots.push(root);
    return root;
  });
  dialogTrust.isTrusted = () => true;
  document.body.innerHTML = '';
  document.body.style.backgroundColor = '';
  history.pushState(null, '', '/i/history');
  resetAccount();
  setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
});

afterEach(() => {
  closeAutoCollectDialog();
  vi.restoreAllMocks();
  dialogTrust.isTrusted = (e: Event) => e.isTrusted;
  history.replaceState(null, '', '/');
});

describe('v72: 確認ダイアログは x.com の上に出る', () => {
  it('「自動で取り込む…」を押すと、管理画面を開かず、x.com の上にダイアログが出る', async () => {
    ensureCollectButton();
    await flush();
    document.querySelector<HTMLButtonElement>('.postshelf-autocollect')!.click();
    await flush();
    expect(host()).toBeTruthy();
    expect(inner('[role=dialog]').textContent).toContain('@me');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(await peekCollectCommand()).toBeNull();
  });

  it('同意のチェックを入れるまで「始める」は押せない', async () => {
    await openAutoCollectDialog();
    expect(startButton().disabled).toBe(true);
    consentBox().click();
    await flush();
    expect(startButton().disabled).toBe(false);
  });

  it('同意して「始める」を押すと、選んだ速度と上限で start が consent: true で呼ばれ、保存され、ダイアログが外れる', async () => {
    await openAutoCollectDialog();
    innerAll<HTMLInputElement>('input[type=radio]')[1].click();
    const cap = inner<HTMLSelectElement>('select');
    cap.value = '100';
    cap.dispatchEvent(new Event('change', { bubbles: true }));
    consentBox().click();
    await flush();
    startButton().click();
    await flush();
    expect(collector.start).toHaveBeenCalledWith({ consent: true, speed: 'normal', cap: 100, accountId: 'me' });
    const saved = (await getSettings()).autoCollect;
    expect([saved.speed, saved.cap]).toEqual(['normal', 100]);
    expect(host()).toBeNull();
    expect(await peekCollectCommand()).toBeNull();
  });

  it('本人の操作でない (isTrusted が false の) チェックは入らない', async () => {
    dialogTrust.isTrusted = (e) => e.isTrusted;
    await openAutoCollectDialog();
    consentBox().click();
    await flush();
    expect(consentBox().checked).toBe(false);
    expect(startButton().disabled).toBe(true);
  });

  it('本人の操作でない「始める」のクリックでは、始まらない', async () => {
    await openAutoCollectDialog();
    consentBox().click();
    await flush();
    dialogTrust.isTrusted = (e) => e.isTrusted;
    startButton().click();
    await flush();
    expect(collector.start).not.toHaveBeenCalled();
    expect(host()).toBeTruthy();
  });

  it('本人の操作でない change だけを送っても、同意は入らない', async () => {
    dialogTrust.isTrusted = (e) => e.isTrusted;
    await openAutoCollectDialog();
    const box = consentBox();
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(box.checked).toBe(false);
    expect(startButton().disabled).toBe(true);
  });

  it('ラベルへの偽のクリックでも、チェックは入らない', async () => {
    dialogTrust.isTrusted = (e) => e.isTrusted;
    await openAutoCollectDialog();
    consentBox().closest('label')!.click();
    await flush();
    expect(consentBox().checked).toBe(false);
  });

  it('設定「自動取り込みを使う」がオフなら、ダイアログは開かない', async () => {
    await updateAutoCollect({ enabled: false });
    await openAutoCollectDialog();
    expect(host()).toBeNull();
  });

  it('開いている間に設定がオフになると、ダイアログが閉じる', async () => {
    await openAutoCollectDialog();
    expect(host()).toBeTruthy();
    await updateAutoCollect({ enabled: false });
    await flush();
    expect(host()).toBeNull();
  });

  it('アカウントを判定できないときは、始められない表示になり、始まらない', async () => {
    setCurrentAccount(null);
    await openAutoCollectDialog();
    expect(inner('[role=alert]')).toBeTruthy();
    consentBox().click();
    await flush();
    expect(startButton().disabled).toBe(true);
    startButton().click();
    await flush();
    expect(collector.start).not.toHaveBeenCalled();
  });

  it('同意したあとにアカウントを判定できなくなったときは、ボタンが無効になり、始まらない', async () => {
    await openAutoCollectDialog();
    consentBox().click();
    await flush();
    // 判定が外れた状態では表示が更新され、ボタンが無効になる
    setCurrentAccount(null);
    await flush();
    expect(startButton().disabled).toBe(true);
    expect(collector.start).not.toHaveBeenCalled();
  });

  it('取り消しで閉じると、ホスト要素が DOM から消える', async () => {
    await openAutoCollectDialog();
    const cancel = inner<HTMLButtonElement>('.dialog-actions button:not(.primary)');
    cancel.click();
    await flush();
    expect(host()).toBeNull();
    expect(collector.start).not.toHaveBeenCalled();
  });

  it('Esc で閉じると、ホスト要素が DOM から消える', async () => {
    await openAutoCollectDialog();
    await press('Escape');
    expect(host()).toBeNull();
  });

  it('閉じたあとに、キーのリスナーが残らない', async () => {
    await openAutoCollectDialog();
    const target = host()!;
    const removed = vi.spyOn(target, 'removeEventListener');
    closeAutoCollectDialog();
    expect(removed.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['keydown', 'keyup', 'keypress']));
  });

  it('すでに開いているときは、もう 1 つ開かない', async () => {
    await openAutoCollectDialog();
    await openAutoCollectDialog();
    expect(document.querySelectorAll('.postshelf-autocollect-dialog').length).toBe(1);
  });

  it('ブックマーク以外のページへ移ると、ダイアログが閉じる', async () => {
    await openAutoCollectDialog();
    history.pushState(null, '', '/home');
    ensureCollectButton();
    expect(host()).toBeNull();
  });

  it('ダイアログの中のキー操作は、ページ側のリスナーに届かない', async () => {
    await openAutoCollectDialog();
    const seen = vi.fn();
    document.addEventListener('keydown', seen);
    await press('j');
    document.removeEventListener('keydown', seen);
    expect(seen).not.toHaveBeenCalled();
  });

  it('配色は X のテーマに合わせる (暗い背景ならダーク)', async () => {
    document.body.style.backgroundColor = 'rgb(0, 0, 0)';
    await openAutoCollectDialog();
    expect((host() as HTMLElement).dataset.theme).toBe('dark');
    closeAutoCollectDialog();
    document.body.style.backgroundColor = 'rgb(255, 255, 255)';
    await openAutoCollectDialog();
    expect((host() as HTMLElement).dataset.theme).toBe('light');
  });

  it('shadow root の中に、共通の CSS が入る', async () => {
    await openAutoCollectDialog();
    expect(inner('style').textContent).toBe(readFileSync('static/autocollect-dialog.css', 'utf8'));
  });
});

describe('v72: ダイアログの CSS の元は 1 か所', () => {
  const dialogCss = readFileSync('static/autocollect-dialog.css', 'utf8');
  it('manager.css は共通の CSS を @import し、同じ規則を持たない', () => {
    const manager = readFileSync('static/manager.css', 'utf8');
    expect(manager).toContain('@import url("autocollect-dialog.css");');
    expect(manager).not.toMatch(/\.ac-dialog\{/);
    expect(manager).not.toMatch(/(^|\n)\.overlay\{/);
  });
  it('展開した管理画面の CSS に、ダイアログの規則が 1 つずつある', () => {
    const css = managerCss();
    expect(css.match(/\.ac-dialog\{/g)).toHaveLength(1);
    expect(css.match(/(^|\n)\.dialog\{/g)).toHaveLength(1);
  });
  it('ダークの値は、media と :host で同じ', () => {
    const block = (head: string) => {
      const from = dialogCss.indexOf(head) + head.length;
      return dialogCss.slice(from, dialogCss.indexOf('}', from));
    };
    expect(block('@media (prefers-color-scheme:dark){:root{').trim()).toBe(block(':host([data-theme=dark]){').trim());
  });
});
