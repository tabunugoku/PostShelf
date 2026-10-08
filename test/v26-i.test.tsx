import { act } from 'preact/test-utils';
import { render } from 'preact';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { COLORS, ICONS, colorLabel, iconLabel } from '../src/shared/models';
import { FolderEdit } from '../src/manager/FolderEdit';

const L = ['ja', 'en', 'zh_CN', 'zh_TW', 'ko', 'es', 'pt_BR', 'fr'];
const msgs = (l: string) => JSON.parse(readFileSync(`static/_locales/${l}/messages.json`, 'utf8')) as Record<string, { message: string }>;

describe('v26-I: aria-labels of the icon and color buttons go through t()', () => {
  beforeEach(() => installChromeMock());

  it('names, not class names / hex values', () => {
    expect(iconLabel('ti-star')).toBe('星');
    expect(colorLabel('#e24b4a')).toBe('赤');
    for (const i of ICONS) expect(iconLabel(i)).not.toMatch(/^ti-/);
    for (const c of COLORS) expect(colorLabel(c)).not.toMatch(/^#/);
    expect(iconLabel('ti-unknown')).toBe('ti-unknown');
  });

  it('every icon and color has a name in all 8 languages (different buttons have different names)', () => {
    const keys = [...ICONS.map((i) => `icon${i.replace('ti-', '')[0].toUpperCase()}${i.replace('ti-', '').slice(1)}`), 'colorRed', 'colorOrange', 'colorGreen', 'colorTeal', 'colorBlue', 'colorPurple', 'colorPink', 'colorGray'];
    for (const l of L) {
      const m = msgs(l);
      for (const k of keys) expect(m[k]?.message, `${l}.${k}`).toBeTruthy();
      expect(new Set(keys.slice(0, ICONS.length).map((k) => m[k].message)).size, `${l} icons`).toBe(ICONS.length);
      expect(new Set(keys.slice(ICONS.length).map((k) => m[k].message)).size, `${l} colors`).toBe(8);
    }
  });

  it('the manager folder editor labels its buttons with names', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const folder = { id: 'f', name: 'x', icon: 'ti-folder', order: 0, accountId: 'me' };
    await act(() => void render(<FolderEdit folder={folder} onSaved={() => {}} onRequestDelete={() => {}} />, document.getElementById('app')!));
    const labels = [...document.querySelectorAll('.ic, .sw')].map((b) => b.getAttribute('aria-label'));
    expect(labels.some((l) => /^ti-|^#/.test(l ?? ''))).toBe(false);
    expect(labels).toContain('星');
    expect(labels).toContain('赤');
  });
});
