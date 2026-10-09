import { act } from 'preact/test-utils';
import { render } from 'preact';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { MAX_BYTES, MAX_DEPTH, blockedWords, buildReport, sanitizeValue, skeleton } from '../src/shared/diagnostics';
import { handleMessage, buildLocalReport } from '../src/content/messages';
import { resetHealth, runHealthCheck } from '../src/content/health';
import { DiagnosticsDialog, makeReport } from '../src/manager/Diagnostics';
import { HealthNotice } from '../src/manager/HealthNotice';
import { SettingsPage } from '../src/manager/Settings';
import { ISSUE_URL } from '../src/shared/links';
import { saveHealth } from '../src/shared/settings';

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 20)));
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends Element>(sel: string) => [...document.querySelectorAll<T>(sel)];

/** 実在しそうな個人情報を詰めた article。診断情報にこれらが 1 つも出てはいけない */
const PII = ['realuser123', 'Taro', 'Yamada', '秘密のテキスト', 'https', 't.co', 'AbCdEf', 'example.com', 'secret-link', '1788888888888888888', 'pbs.twimg', 'avatar.jpg', 'id__abc123xyz', '1 reply', 'secretly'];
const ARTICLE = `
<article role="article" data-testid="tweet" aria-labelledby="id__abc123xyz" aria-describedby="id__zzz" tabindex="0">
  <div data-testid="UserAvatar-Container-realuser123"><a role="link" href="/realuser123" aria-label="Profile of Taro Yamada"><img src="https://pbs.twimg.com/profile_images/9999/avatar.jpg" alt="Taro Yamada"></a></div>
  <div data-testid="User-Name"><span>Taro Yamada</span><span>@realuser123</span><a href="/realuser123/status/1788888888888888888"><time datetime="2026-10-01T00:00:00Z">3h</time></a></div>
  <div data-testid="tweetText" lang="ja"><span>秘密のテキスト</span> <a href="https://t.co/AbCdEf">t.co/AbCdEf</a></div>
  <a href="https://example.com/secret-link">example.com</a>
  <div data-testid="someNewThing-realuser123"></div>
  <div role="group" aria-label="1 reply, 2 reposts"><div><button data-testid="bookmark" aria-label="Save this post secretly"></button></div></div>
</article>`;

const mount = (html: string) => {
  document.body.innerHTML = html;
  return document.querySelector('article')!;
};

describe('skeleton privacy', () => {
  it('keeps only tag / role / data-testid / aria-* names; no text, links, image URLs, handles, names or IDs', () => {
    const a = mount(ARTICLE);
    const out = skeleton(a, blockedWords(a));
    for (const p of PII) expect(out.toLowerCase(), p).not.toContain(p.toLowerCase());
    // 構造の手がかりは残る
    expect(out).toContain('article[role=article][testid=tweet] aria-describedby,aria-labelledby');
    expect(out).toContain('[testid=User-Name]');
    expect(out).toContain('[testid=tweetText]');
    expect(out).toContain('[testid=bookmark]');
    expect(out).toContain('[role=group] aria-label');
    expect(out).toContain('[testid=UserAvatar-Container-?]'); // ユーザー名は ? に置き換わる
    expect(out).toContain('[testid=?]'); // someNewThing-<ユーザー名> は全体が ? になる
  });

  it('unknown words in data-testid values are masked, even camelCase ones', () => {
    expect(sanitizeValue('UserAvatar-Container-bob_99')).toBe('UserAvatar-Container-?');
    expect(sanitizeValue('tweetText')).toBe('tweetText');
    expect(sanitizeValue('card.wrapper')).toBe('card.wrapper');
    expect(sanitizeValue('someNewThing')).toBe('?');
    expect(sanitizeValue('someNewThing-bob_99')).toBe('?');
    expect(sanitizeValue('apple', ['apple'])).toBe('?');
    expect(sanitizeValue('x'.repeat(200)).length).toBeLessThanOrEqual(60);
  });

  it('unknown role values are masked', () => {
    const a = mount('<article role="x-secret-role"><div role="group"></div></article>');
    const out = skeleton(a);
    expect(out).toContain('[role=?]');
    expect(out).toContain('[role=group]');
  });

  it('the full report has version, UA, language and health, and still no personal data', async () => {
    const a = mount(ARTICLE);
    const text = buildReport({
      version: '1.2.3',
      userAgent: 'Mozilla/5.0 Test',
      uiLanguage: 'ja',
      health: { state: 'degraded', checkedAt: 0, missing: [], fallback: ['userName'] },
      skeleton: skeleton(a, blockedWords(a)),
    });
    expect(text).toContain('PostShelf 1.2.3');
    expect(text).toContain('userAgent: Mozilla/5.0 Test');
    expect(text).toContain('uiLanguage: ja');
    expect(text).toContain('health: degraded');
    expect(text).toContain('fallback=[userName]');
    for (const p of PII) expect(text.toLowerCase(), p).not.toContain(p.toLowerCase());
  });
});

describe('skeleton limits', () => {
  it('is at most 6KB, with a truncation marker', () => {
    const wide = `<article>${'<div data-testid="tweet" aria-label="x" role="group"><span></span><span></span></div>'.repeat(400)}</article>`;
    const out = skeleton(mount(wide));
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(MAX_BYTES);
    expect(out).toContain('…(truncated)');
  });
  it('goes at most 8 levels deep below the article', () => {
    const deep = `<article>${'<div>'.repeat(30)}${'</div>'.repeat(30)}</article>`;
    const lines = skeleton(mount(deep)).split('\n');
    expect(lines.length).toBe(MAX_DEPTH + 1); // article (深さ 0) 〜 深さ 8
    expect(lines.at(-1)).toBe(`${'  '.repeat(MAX_DEPTH)}div`);
  });
});

describe('content script', () => {
  beforeEach(() => {
    installChromeMock();
    resetHealth();
    (globalThis as any).chrome.runtime = { getManifest: () => ({ version: '9.9.9' }) };
  });
  it('getDiagnostics answers with a report of the first post on the page', async () => {
    mount(ARTICLE);
    runHealthCheck();
    const reply = vi.fn();
    expect(handleMessage({ type: 'getDiagnostics' }, reply)).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    const { ok, report } = reply.mock.calls[0][0];
    expect(ok).toBe(true);
    expect(report).toContain('PostShelf 9.9.9');
    expect(report).toContain('health:');
    for (const p of PII) expect(report.toLowerCase(), p).not.toContain(p.toLowerCase());
    expect(await buildLocalReport()).toContain('article[role=article]');
  });
});

describe('diagnostics dialog (user-initiated copy only)', () => {
  beforeEach(() => {
    installChromeMock();
    document.body.innerHTML = '<div id="app"></div>';
    (globalThis as any).chrome.tabs = { query: async () => [] };
  });

  it('without an x.com tab it still builds a report from what the extension knows', async () => {
    await saveHealth({ state: 'broken', checkedAt: 1, missing: ['userName'], fallback: [] });
    const text = await makeReport();
    expect(text).toContain('health: broken');
    expect(text).toContain('missing=[userName]');
    expect(text).toContain('(no x.com tab was available)');
  });

  it('with an x.com tab it uses the content script report', async () => {
    (globalThis as any).chrome.tabs = {
      query: async () => [{ id: 3, active: true }],
      sendMessage: async () => ({ ok: true, report: 'REPORT FROM TAB' }),
    };
    expect(await makeReport()).toBe('REPORT FROM TAB');
  });

  it('shows the content and the notice first; copies only when the user presses 「コピー」; reports via a safe new-tab link', async () => {
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    await act(() => void render(<DiagnosticsDialog onClose={() => {}} />, $('#app')));
    await flush();
    expect($('[role=dialog]').textContent).toContain('この内容がクリップボードにコピーされます。ポストの本文、ユーザー名、URL は含まれません。含まれるのは、拡張機能のバージョン、ブラウザの情報、表示言語、X の画面構造の骨組みです。');
    expect($('.diag-pre').textContent).toContain('PostShelf 9.9.9');
    expect(write).not.toHaveBeenCalled(); // 表示しただけではコピーしない
    const link = $<HTMLAnchorElement>('a.btn-link');
    expect(link.href).toBe(ISSUE_URL);
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    await act(() => void $<HTMLButtonElement>('.primary').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect((write.mock.calls[0] as unknown as string[])[0]).toBe($('.diag-pre').textContent);
    expect($('[role=status]').textContent).toBe('コピーしました');
  });

  it('closes with Escape without copying', async () => {
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    const close = vi.fn();
    await act(() => void render(<DiagnosticsDialog onClose={close} />, $('#app')));
    await flush();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(close).toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});

describe('health notices', () => {
  beforeEach(() => {
    installChromeMock();
    document.body.innerHTML = '<div id="app"></div>';
    (globalThis as any).chrome.tabs = { query: async () => [] };
  });
  const show = async (node: preact.VNode) => {
    await act(() => void render(node, $('#app')));
    await flush();
  };

  it('ok: nothing in the popup, "正常 (最終確認…)" in settings', async () => {
    await saveHealth({ state: 'ok', checkedAt: Date.UTC(2026, 9, 7, 12, 0), missing: [], fallback: [] });
    await show(<HealthNotice />);
    expect($('#app').textContent).toBe('');
    await show(<HealthNotice showOk />);
    expect($('#app').textContent).toContain('正常（最終確認:');
  });
  it('unknown (never checked): nothing in the popup, 未確認 in settings', async () => {
    await show(<HealthNotice />);
    expect($('#app').textContent).toBe('');
    await show(<HealthNotice showOk />);
    expect($('#app').textContent).toContain('未確認');
  });
  it('degraded: "X の画面構造が一部変わっています。動作は続いています。"', async () => {
    await saveHealth({ state: 'degraded', checkedAt: 1, missing: [], fallback: ['tweet'] });
    await show(<HealthNotice />);
    expect($('.health-degraded').textContent).toContain('X の画面構造が一部変わっています。動作は続いています。');
    expect($$('.health-btn').length).toBe(0);
  });
  it('broken: message plus a button to the diagnostics', async () => {
    await saveHealth({ state: 'broken', checkedAt: 1, missing: ['userName'], fallback: [] });
    const diagnose = vi.fn();
    await show(<HealthNotice onDiagnose={diagnose} />);
    expect($('.health-broken').textContent).toContain('X の画面構造が変わったため、一部の機能を止めています。診断情報をコピーして GitHub で報告してください。');
    await act(() => void $('.health-btn').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(diagnose).toHaveBeenCalled();
  });
  it('updates live when the content script saves a new result', async () => {
    await show(<HealthNotice />);
    expect($$('.health').length).toBe(0);
    await saveHealth({ state: 'broken', checkedAt: 2, missing: ['time'], fallback: [] });
    await flush();
    expect($$('.health-broken').length).toBe(1);
  });
  it('settings page: has the status section and the copy button', async () => {
    await saveHealth({ state: 'ok', checkedAt: 5, missing: [], fallback: [] });
    await show(<SettingsPage onChanged={() => {}} onApplied={() => {}} onNotice={() => {}} />);
    expect($('.setting-group legend + *') || $('legend')).toBeTruthy();
    expect($$('legend').map((l) => l.textContent)).toContain('X の画面構造');
    const btn = $$('button').find((b) => b.textContent?.includes('診断情報をコピー'))!;
    await act(() => void btn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();
    expect($('[role=dialog]')).toBeTruthy();
  });
});

describe('issue template', () => {
  const tpl = readFileSync(resolve(process.cwd(), '.github/ISSUE_TEMPLATE/selector-broken.md'), 'utf8');
  it('has the diagnostic paste field, the X display language and the page', () => {
    expect(tpl).toMatch(/^---\nname:/);
    expect(tpl).toContain('## 診断情報');
    expect(tpl).toContain('## X の表示言語');
    expect(tpl).toContain('## 発生したページ');
  });
  it('the report link points at the template and is defined in one place', () => {
    expect(ISSUE_URL).toContain('template=selector-broken.md');
    const src = readFileSync(resolve(process.cwd(), 'src/manager/Diagnostics.tsx'), 'utf8');
    expect(src).not.toContain('github.com');
  });
});
