import { act } from 'preact/test-utils';
import { render } from 'preact';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { SettingsPage } from '../src/manager/Settings';
import { REPO_URL } from '../src/shared/links';

const $ = <T extends Element>(s: string) => document.querySelector<T>(s)!;

beforeEach(async () => {
  installChromeMock();
  document.body.innerHTML = '<div id="app"></div>';
  await act(() => void render(<SettingsPage onChanged={() => {}} onApplied={() => {}} onNotice={() => {}} />, $('#app')));
  await act(() => new Promise<void>((r) => setTimeout(r, 20)));
});
afterEach(() => render(null, $('#app')));

describe('v23: 設定画面の GitHub のリンク', () => {
  it('is an <a> at the bottom of the data group, under the version, opening the repository in a new tab safely', () => {
    const a = $<HTMLAnchorElement>('a.link-btn');
    expect(a.tagName).toBe('A');
    expect(a.getAttribute('href')).toBe('https://github.com/tabunugoku/PostShelf');
    expect(a.getAttribute('href')).toBe(REPO_URL);
    expect(a.target).toBe('_blank');
    expect(a.rel).toContain('noopener');
    expect(a.rel).toContain('noreferrer');
    expect(a.textContent?.trim()).toBe('GitHub で見る');
    expect(a.getAttribute('aria-label')).toBe('GitHub で見る（新しいタブで開きます）');
    const icons = [...a.querySelectorAll('i')].map((i) => i.className);
    expect(icons[0]).toContain('ti-brand-github'); // 左にロゴ
    expect(icons[1]).toContain('ti-external-link'); // 右に外部リンク
    const group = a.closest('fieldset')!;
    const kids = [...group.children];
    expect(kids.indexOf(a.closest('.repo-link')!)).toBeGreaterThan(kids.indexOf($('.version-info')));
    expect(a.tabIndex).toBe(0); // Tab で届く (a[href] は標準でフォーカスできる)
  });

  it('the settings text already shown is unchanged (version, update guide)', () => {
    expect($('.version-info').textContent).toContain('バージョン');
    expect(document.body.textContent).toContain('更新と手動インストールの手順');
  });

  it('the repository URL is defined in one place only (src/shared/links.ts)', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && readFileSync(p, 'utf8').includes('github.com/tabunugoku/PostShelf')) hits.push(p);
      }
    };
    walk('src');
    expect(hits).toEqual([join('src', 'shared', 'links.ts')]);
    expect(readFileSync('src/shared/links.ts', 'utf8').match(/github\.com\/tabunugoku\/PostShelf/g)).toHaveLength(1);
  });

  it('adds no permission and no network code: the link is a plain anchor', () => {
    const m = JSON.parse(readFileSync('static/manifest.json', 'utf8'));
    expect(m.permissions).toEqual(['storage', 'unlimitedStorage', 'sidePanel']);
    expect(m.host_permissions).toEqual(['https://x.com/*', 'https://twitter.com/*']);
  });
});
