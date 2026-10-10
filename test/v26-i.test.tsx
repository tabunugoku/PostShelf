import { act } from 'preact/test-utils';
import { render } from 'preact';
import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { COLORS, ICONS, colorLabel, iconLabel } from '../src/shared/models';
import { t } from '../src/shared/strings';
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

  it.each(L)('the manager folder editor labels every icon and color in %s', async (lang) => {
    installChromeMock(lang);
    document.body.innerHTML = '<div id="app"></div>';
    const folder = { id: 'f', name: 'Sample folder', icon: 'ti-folder', order: 0, accountId: 'me' };
    await act(() => void render(<FolderEdit folder={folder} onSaved={() => {}} onRequestDelete={() => {}} />, document.getElementById('app')!));
    const icons = [...document.querySelectorAll<HTMLElement>('[data-icon]')];
    expect(icons).toHaveLength(ICONS.length);
    expect(icons.map(b => b.getAttribute('aria-label'))).toEqual(ICONS.map(iconLabel));
    const colors = [...document.querySelectorAll<HTMLElement>('[data-color]')];
    expect(colors).toHaveLength(COLORS.length + 1);
    expect(colors.slice(1).map(b => b.getAttribute('aria-label'))).toEqual(COLORS.map(colorLabel));
    expect(colors[0].getAttribute('aria-label')).toBe(t('colorNone'));
    await act(() => void render(null, document.getElementById('app')!));
  });
});
