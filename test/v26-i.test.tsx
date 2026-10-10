import { act } from 'preact/test-utils';
import { render } from 'preact';
import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { COLORS, ICONS, colorLabel, iconLabel } from '../src/shared/models';
import { FolderEdit } from '../src/manager/FolderEdit';

const L = ['ja', 'en', 'zh_CN', 'zh_TW', 'ko', 'es', 'pt_BR', 'fr'];

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
    for (const l of L) {
      installChromeMock(l);
      for (const i of ICONS) expect(iconLabel(i), `${l}.${i}`).not.toMatch(/^ti-|^icon/);
      expect(new Set(ICONS.map(iconLabel)).size, `${l} icons`).toBe(ICONS.length);
      expect(new Set(COLORS.map(colorLabel)).size, `${l} colors`).toBe(8);
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
