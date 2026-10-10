import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FolderEdit } from '../src/manager/FolderEdit';
import { iconLabel, type Folder } from '../src/shared/models';
import { t } from '../src/shared/strings';
import { installChromeMock } from './chrome-mock';

const folder: Folder = { id: 'sample-folder', name: 'Sample folder', icon: 'ti-folder', order: 0 };
const mount = async (icon = folder.icon) => {
  await act(() => void render(<FolderEdit folder={{ ...folder, icon }} onSaved={() => {}} />, document.querySelector('#app')!));
};
const click = async (el: Element) => act(() => void (el as HTMLElement).click());
const more = () => document.querySelector<HTMLButtonElement>('.icon-more')!;
beforeEach(() => { installChromeMock(); document.body.innerHTML = '<div id="app"></div>'; });
afterEach(() => act(() => void render(null, document.querySelector('#app')!)));

it('shows a square icon-only More control with its existing accessible name and title', async () => {
  await mount();
  expect(more().textContent).toBe('');
  expect(more().classList.contains('ic')).toBe(true);
  expect(more().querySelector('.ti-dots')).not.toBeNull();
  expect(more().getAttribute('aria-label')).toBe(t('iconMore'));
  expect(more().title).toBe(t('iconMore'));
  expect(more().getAttribute('aria-expanded')).toBe('false');
  await click(more());
  expect(more().getAttribute('aria-expanded')).toBe('true');
});
it('replaces the dots with the drafted extra icon and announces both names', async () => {
  await mount(); await click(more());
  await click(document.querySelector('[data-icon="ti-cat"]')!);
  expect(more().textContent).toBe('');
  expect(more().querySelector('.ti-cat')).not.toBeNull();
  expect(more().querySelector('.ti-dots')).toBeNull();
  expect(more().getAttribute('aria-pressed')).toBe('true');
  expect(more().getAttribute('aria-label')).toContain(t('iconMore'));
  expect(more().getAttribute('aria-label')).toContain(iconLabel('ti-cat'));
  await click(document.querySelector('[data-icon="ti-star"]')!);
  expect(more().querySelector('.ti-dots')).not.toBeNull();
  expect(more().querySelector('.ti-cat')).toBeNull();
  expect(more().getAttribute('aria-pressed')).toBe('false');
  expect(more().getAttribute('aria-label')).toBe(t('iconMore'));
});
it('shows and announces an already saved extra icon when opened', async () => {
  await mount('ti-movie');
  expect(more().querySelector('.ti-movie')).not.toBeNull();
  expect(more().getAttribute('aria-label')).toContain(iconLabel('ti-movie'));
});
it('keeps nine controls on a dedicated row, scales only this row and retains the menu width', async () => {
  await mount();
  expect(document.querySelectorAll('.folder-icon-row > button')).toHaveLength(9);
  expect(document.querySelector('.folder-icon-row')?.classList.contains('wrap')).toBe(false);
  const css = readFileSync('static/manager.css', 'utf8');
  expect(css).toMatch(/\.folder-edit \.folder-icon-row\{[^}]*grid-template-columns:[^}]*repeat\(9,/);
  expect(css).toMatch(/\.folder-edit \.folder-icon-row \.ic\{[^}]*aspect-ratio:1/);
  expect(css).toMatch(/\.folder-edit \.icon-more\{[^}]*border:[^}]*dashed/);
  expect(css).toContain('.menu-edit{width:min(440px,calc(100vw - 16px));max-width:none}');
  expect(readFileSync('node_modules/@tabler/icons-webfont/dist/tabler-icons.min.css', 'utf8')).toContain('.ti-dots:before');
});
