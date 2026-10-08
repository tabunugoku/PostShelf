import { act } from 'preact/test-utils';
import { render } from 'preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { App } from '../src/manager/App';
import { SettingsPage } from '../src/manager/Settings';
import { AutoCollectPanel, viewOf } from '../src/content/autocollectPanel';
import type { AutoCollector, CollectState } from '../src/content/autocollect';
import { noteAccount, setAccountScope, setBookmarkFolders } from '../src/shared/storage';
import { getSettings, peekCollectCommand, saveCollectRun, setCollectOffer, updateAutoCollect } from '../src/shared/settings';

const flush = (ms = 25) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends Element>(sel: string) => [...document.querySelectorAll<T>(sel)];
const click = async (el: Element) => {
  await act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  await flush();
};
const byText = (sel: string, text: string) => $$<HTMLElement>(sel).find((e) => e.textContent?.includes(text))!;
let data: Record<string, any>;
let tabs: { create: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  data = installChromeMock() as Record<string, any>;
  tabs = { create: vi.fn(async () => ({})), query: vi.fn(async () => []), update: vi.fn(async () => ({})) };
  (globalThis as any).chrome.tabs = tabs;
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, '', '/');
  setAccountScope('unknown');
  await noteAccount({ handle: 'me', displayName: 'Me' });
});
const mount = async () => {
  await act(() => void render(<App />, $('#app')));
  await flush(40);
};

describe('manager: the offer banner (it never starts anything by itself)', () => {
  it('shows for an account with no data; "取り込みを始める…" only opens the confirmation; nothing is written until the user agrees', async () => {
    await mount();
    expect($('.ac-offer').textContent).toContain('X のブックマークを取り込みますか？');
    expect($('.ac-offer').textContent).toContain('@me');
    expect(await peekCollectCommand()).toBeNull();
    expect(tabs.create).not.toHaveBeenCalled();
    await click(byText('.ac-offer button', '取り込みを始める…'));
    expect($('[role=dialog].ac-dialog')).toBeTruthy();
    expect(await peekCollectCommand()).toBeNull();
    expect(tabs.create).not.toHaveBeenCalled();
  });

  it('the dialog: the start button stays disabled until the consent box is checked; then it writes a command with consent and opens x.com', async () => {
    await mount();
    await click(byText('.ac-offer button', '取り込みを始める…'));
    const dlg = $('.ac-dialog');
    expect(dlg.textContent).toContain('@me');
    expect(dlg.textContent).toContain('ゆっくり（おすすめ）');
    expect(dlg.textContent).toContain('300 件ごとに一度止める（おすすめ）');
    expect(dlg.textContent).toContain('同じ順で並びます');
    expect(dlg.textContent).toContain('「自動化されたアクセス」とみなされる可能性があります');
    expect(dlg.textContent).toContain('責任を負えません');
    const start = byText('.ac-dialog .dialog-actions button', '取り込みを始める') as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    await click(start);
    expect(await peekCollectCommand()).toBeNull(); // 押しても何も起きない
    // 速度と上限を選んで、同意する
    await click(dlg.querySelectorAll('input[type=radio]')[1]);
    const select = dlg.querySelector('select')!;
    await act(() => {
      select.value = '100';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click(dlg.querySelector('input[type=checkbox]')!);
    expect(start.disabled).toBe(false);
    await click(start);
    const cmd = (await peekCollectCommand())!;
    expect(cmd).toMatchObject({ type: 'start', consent: true, speed: 'normal', cap: 100, accountId: 'me' });
    expect(tabs.create).toHaveBeenCalledWith({ url: 'https://x.com/i/history' });
    expect($$('.ac-dialog').length).toBe(0);
    expect((await getSettings()).autoCollect).toMatchObject({ speed: 'normal', cap: 100 }); // 次回の既定
  });

  it('with an x.com history tab already open, that tab is used (no new tab)', async () => {
    tabs.query.mockResolvedValue([{ id: 9, windowId: 3, url: 'https://x.com/i/history' }]);
    await mount();
    await click(byText('.ac-offer button', '取り込みを始める…'));
    await click($('.ac-dialog input[type=checkbox]'));
    await click(byText('.ac-dialog .dialog-actions button', '取り込みを始める'));
    expect(tabs.update).toHaveBeenCalledWith(9, { active: true });
    expect(tabs.create).not.toHaveBeenCalled();
  });

  it('Esc / キャンセル close the dialog without starting', async () => {
    await mount();
    await click(byText('.ac-offer button', '取り込みを始める…'));
    await act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect($$('.ac-dialog').length).toBe(0);
    expect(await peekCollectCommand()).toBeNull();
  });

  it('「あとで」 hides it for now; 「このアカウントでは表示しない」 records it for the account', async () => {
    await mount();
    await click(byText('.ac-offer button', 'あとで'));
    expect($$('.ac-offer').length).toBe(0);
    document.body.innerHTML = '<div id="app"></div>';
    await mount();
    expect($$('.ac-offer').length).toBe(1); // あとで は、この画面を開いている間だけ
    await click(byText('.ac-offer button', 'このアカウントでは表示しない'));
    expect($$('.ac-offer').length).toBe(0);
    expect((await getSettings()).autoCollect.offers).toEqual({ me: 'dismissed' });
    document.body.innerHTML = '<div id="app"></div>';
    await mount();
    expect($$('.ac-offer').length).toBe(0);
  });

  it('is not shown when the account already has data, the account is not known, it was done/dismissed, or the feature is off', async () => {
    await setBookmarkFolders('1', [], { text: 't', author: 'A', handle: '@a', media: [], url: 'https://x.com/a/status/1' });
    // (まだ scope は unknown。me に切り替えて保存する)
    setAccountScope('me');
    await setBookmarkFolders('1', [], { text: 't', author: 'A', handle: '@a', media: [], url: 'https://x.com/a/status/1' });
    await mount();
    expect($$('.ac-offer').length).toBe(0);
    for (const prep of [async () => updateAutoCollect({ enabled: false }), async () => setCollectOffer('me', 'done')]) {
      data.bookmarks = {};
      await prep();
      document.body.innerHTML = '<div id="app"></div>';
      await mount();
      expect($$('.ac-offer').length).toBe(0);
    }
  });

  it('the feature off: no offer, no dialog even with #autocollect', async () => {
    await updateAutoCollect({ enabled: false });
    history.replaceState(null, '', '/#autocollect');
    await mount();
    expect($$('.ac-offer').length).toBe(0);
    expect($$('.ac-dialog').length).toBe(0);
  });

  it('#autocollect (from the button on x.com) opens the confirmation', async () => {
    history.replaceState(null, '', '/#autocollect');
    await mount();
    expect($('.ac-dialog')).toBeTruthy();
    expect(await peekCollectCommand()).toBeNull();
  });
});

describe('manager: progress banner', () => {
  const run = (over: object = {}) => ({ status: 'running', accountId: 'me', startedAt: 1, imported: 128, skipped: 12, failed: 0, speed: 'slow', cap: 300, updatedAt: 5, ...over });
  it('shows the counts, with 一時停止 / 停止 / x.com のタブを開く that send commands', async () => {
    await saveCollectRun(run() as any);
    await mount();
    const b = $('.ac-progress');
    expect(b.textContent).toContain('ブックマークを取り込み中: 128 件取り込み、12 件スキップ');
    expect(b.getAttribute('role')).toBe('status');
    await click(byText('.ac-progress button', '一時停止'));
    expect((await peekCollectCommand())!.type).toBe('pause');
    await click($$<HTMLElement>('.ac-progress button').find((b) => b.textContent === '停止')!);
    expect((await peekCollectCommand())!.type).toBe('stop');
    await click(byText('.ac-progress button', 'x.com のタブを開く'));
    expect(tabs.create).toHaveBeenCalled();
  });
  it('paused shows 再開, a limit shows the alert, done can be closed', async () => {
    await saveCollectRun(run({ status: 'paused', reason: 'hidden' }) as any);
    await mount();
    await click(byText('.ac-progress button', '再開'));
    expect((await peekCollectCommand())!.type).toBe('resume');
    await saveCollectRun(run({ status: 'limit', updatedAt: 6 }) as any);
    await flush();
    expect($('.ac-progress').textContent).toContain('15 分以上あけてから再開してください');
    await saveCollectRun(run({ status: 'done', updatedAt: Date.now() }) as any);
    await flush();
    expect($('.ac-progress').textContent).toContain('取り込みが終わりました');
    await click(byText('.ac-progress button', '閉じる'));
    expect($$('.ac-progress').length).toBe(0);
  });
});

describe('settings: 自動取り込みを使う', () => {
  const show = async (onAuto = vi.fn()) => {
    await act(() => void render(<SettingsPage onChanged={() => {}} onApplied={() => {}} onNotice={() => {}} onAutoCollect={onAuto} />, $('#app')));
    await flush();
    return onAuto;
  };
  it('the switch is on by default; off hides the run button and the note; the run button only opens the confirmation', async () => {
    const onAuto = await show();
    const sw = $$<HTMLInputElement>('input[role=switch]').find((i) => i.closest('label')?.textContent?.includes('自動取り込みを使う'))!;
    expect(sw.checked).toBe(true);
    await click(byText('button', 'ブックマークを自動で取り込む…'));
    expect(onAuto).toHaveBeenCalledTimes(1);
    expect(await peekCollectCommand()).toBeNull();
    await act(async () => {
      sw.checked = false;
      sw.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    expect((await getSettings()).autoCollect.enabled).toBe(false);
    expect($$('button').some((b) => b.textContent?.includes('ブックマークを自動で取り込む…'))).toBe(false);
  });
});

describe('page panel: dates (v27)', () => {
  const stub = () => ({ pause: vi.fn(), resume: vi.fn(), resumeLater: vi.fn(), stop: vi.fn(), dismiss: vi.fn() }) as unknown as AutoCollector;
  const st = (over: Partial<CollectState> = {}): CollectState => ({ status: 'running', accountId: 'me', startedAt: 1, imported: 1, skipped: 0, failed: 0, speed: 'slow', cap: 300, updatedAt: 1, ...over });
  beforeEach(() => {
    document.body.innerHTML = '';
    history.pushState(null, '', '/i/history');
  });

  it('running shows recentPostDate; paused shows the oldest', () => {
    const p = new AutoCollectPanel(stub(), () => {});
    const dates = { oldestSeenPostDate: '2020-01-05T00:00:00Z', recentPostDate: '2026-09-28T00:00:00Z' };
    p.update(st(dates));
    const text = $('.postshelf-autocollect-panel').textContent ?? '';
    expect(text).toContain('2026');
    expect(text).not.toContain('2020');
    p.update(st({ ...dates, status: 'paused', reason: 'user' }));
    expect($('.postshelf-autocollect-panel').textContent).toContain('2020');
  });

  it('running without recentPostDate falls back to the plain sub text', () => {
    const p = new AutoCollectPanel(stub(), () => {});
    p.update(st({ oldestSeenPostDate: '2020-01-05T00:00:00Z' }));
    expect($('.postshelf-autocollect-panel').textContent).not.toContain('2020');
  });
});

describe('page panel', () => {
  const stub = () => ({ pause: vi.fn(), resume: vi.fn(), resumeLater: vi.fn(), stop: vi.fn(), dismiss: vi.fn() }) as unknown as AutoCollector & Record<string, ReturnType<typeof vi.fn>>;
  const st = (over: Partial<CollectState> = {}): CollectState => ({ status: 'running', accountId: 'me', startedAt: 1, imported: 128, skipped: 12, failed: 0, speed: 'slow', cap: 300, updatedAt: 1, ...over });
  beforeEach(() => {
    document.body.innerHTML = '';
    history.pushState(null, '', '/i/history');
  });

  it('running: role=status aria-live=polite, counts, an indeterminate bar, 一時停止 / 停止', () => {
    const c = stub();
    const p = new AutoCollectPanel(c, () => {});
    p.update(st({ oldestSeenPostDate: '2026-09-28T00:00:00Z' }));
    const el = $('.postshelf-autocollect-panel');
    expect(el.getAttribute('role')).toBe('status');
    expect(el.getAttribute('aria-live')).toBe('polite');
    expect(el.textContent).toContain('ブックマークを取り込み中');
    expect(el.textContent).toContain('128');
    expect(el.textContent).toContain('スキップ');
    expect(el.textContent).toContain('このタブを開いたままにしてください');
    expect([...el.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['一時停止', '停止', '畳む']);
    expect(document.documentElement.hasAttribute('data-postshelf-panel')).toBe(true); // 右下の取り込みボタンは隠れる
    (el.querySelector('[data-action=pause]') as HTMLElement).click();
    (el.querySelector('[data-action=stop]') as HTMLElement).click();
    expect(c.pause).toHaveBeenCalledWith('user');
    expect(c.stop).toHaveBeenCalled();
  });

  it('every state has its own title and buttons (paused / limit / done / stopped / countdown)', () => {
    expect(viewOf(st({ status: 'paused', reason: 'hidden' }))).toMatchObject({ title: '一時停止中', sub: '別のタブに切り替えたため、自動で止めました' });
    expect(viewOf(st({ status: 'paused', reason: 'hidden' })).buttons.map((b) => b.label)).toEqual(['再開', 'ここで終了']);
    expect(viewOf(st({ status: 'paused', reason: 'cap' })).sub).toBe('上限の 300 件に達したため、止めました');
    expect(viewOf(st({ status: 'paused', reason: 'reload' })).note).toContain('一覧の先頭から読み直します');
    const limit = viewOf(st({ status: 'limit', reason: 'limit' }));
    expect(limit.title).toBe('自動で止めました');
    expect(limit.alert).toContain('15 分以上あけてから再開してください');
    expect(limit.buttons.map((b) => b.label)).toEqual(['15 分後に再開する', 'ここで終了']);
    expect(viewOf(st({ status: 'limit', resumeAt: Date.now() + 1000 })).buttons.map((b) => b.label)).toEqual(['ここで終了']);
    expect(viewOf(st({ status: 'done' })).title).toBe('取り込みが終わりました');
    expect(viewOf(st({ status: 'done' })).buttons.map((b) => b.label)).toEqual(['仕分ける', '閉じる']); // 取り込めた分がある
    expect(viewOf(st({ status: 'done', imported: 0 })).buttons.map((b) => b.label)).toEqual(['管理画面を開く', '閉じる']);
    expect(viewOf(st({ status: 'stopped', reason: 'user' })).buttons.map((b) => b.label)).toEqual(['閉じる']);
    expect(viewOf(st({ status: 'countdown', countdown: 3 })).title).toBe('3 秒後に始まります');
    expect(viewOf(st({ status: 'countdown', countdown: 3 })).buttons.map((b) => b.label)).toEqual(['キャンセル']);
  });

  it('the buttons call the collector: resume / resumeLater / end / close / open the manager', () => {
    const c = stub();
    const open = vi.fn();
    const p = new AutoCollectPanel(c, open);
    p.update(st({ status: 'limit', reason: 'limit' }));
    (document.querySelector('[data-action=resumeLater]') as HTMLElement).click();
    expect(c.resumeLater).toHaveBeenCalled();
    p.update(st({ status: 'paused', reason: 'user' }));
    (document.querySelector('[data-action=resume]') as HTMLElement).click();
    expect(c.resume).toHaveBeenCalled();
    p.update(st({ status: 'done' }));
    (document.querySelector('[data-action=triage]') as HTMLElement).click();
    expect(open).toHaveBeenCalledWith('#triage');
    (document.querySelector('[data-action=close]') as HTMLElement).click();
    expect(c.dismiss).toHaveBeenCalled();
  });

  it('is removed when the state is null and is not shown outside the bookmarks tab', () => {
    const p = new AutoCollectPanel(stub(), () => {});
    p.update(st());
    expect($$('.postshelf-autocollect-panel').length).toBe(1);
    p.update(null);
    expect($$('.postshelf-autocollect-panel').length).toBe(0);
    expect(document.documentElement.hasAttribute('data-postshelf-panel')).toBe(false);
    history.pushState(null, '', '/i/history/likes');
    p.update(st());
    expect($$('.postshelf-autocollect-panel').length).toBe(0);
    history.pushState(null, '', '/home');
    p.update(st());
    expect($$('.postshelf-autocollect-panel').length).toBe(0);
  });

  it('colors follow the X theme (light / dark / dim blue) so that it is readable on each', () => {
    const colors: string[] = [];
    for (const bg of ['rgb(255, 255, 255)', 'rgb(0, 0, 0)', 'rgb(21, 32, 43)']) {
      document.body.style.backgroundColor = bg;
      const p = new AutoCollectPanel(stub(), () => {});
      p.update(st());
      const panelEl = $<HTMLElement>('.postshelf-autocollect-panel');
      colors.push(`${panelEl.style.background}|${panelEl.style.color}`);
      p.hide();
    }
    document.body.style.backgroundColor = '';
    expect(new Set(colors).size).toBe(3);
    expect(colors[0]).toContain('rgb(255, 255, 255)');
  });
});

describe('page buttons: 2 choices on /i/history', () => {
  it('「自動で取り込む…」 is next to the manual button; it only asks the manager to open the confirmation; it is hidden when the feature is off', async () => {
    const { ensureCollectButton, refreshAutoButton } = await import('../src/content/collect');
    const { resetAccount, setCurrentAccount } = await import('../src/content/account');
    resetAccount();
    setCurrentAccount({ id: 'me', handle: 'me', lastSeenAt: 0 });
    document.body.innerHTML = '';
    history.pushState(null, '', '/i/history');
    const sent: unknown[] = [];
    (globalThis as any).chrome.runtime.sendMessage = async (m: unknown) => void sent.push(m);
    ensureCollectButton();
    await flush();
    const auto = $<HTMLButtonElement>('.postshelf-autocollect');
    expect($('.postshelf-collect')).toBeTruthy(); // いま見えている分だけ取り込む (これまでのボタン)
    expect(auto.textContent).toBe('自動で取り込む…');
    expect(auto.style.display).not.toBe('none');
    auto.click();
    expect(sent).toEqual([{ type: 'openAutoCollect' }]); // ここでは始まらない。管理画面の確認ダイアログが開く
    expect(await peekCollectCommand()).toBeNull();
    await updateAutoCollect({ enabled: false });
    await refreshAutoButton();
    expect(auto.style.display).toBe('none');
    history.pushState(null, '', '/home');
    ensureCollectButton();
    expect($$('.postshelf-autocollect').length).toBe(0);
    history.replaceState(null, '', '/');
  });
});
