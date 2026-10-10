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
const more = () => document.querySelector<HTMLButtonElement>('[data-icon-more]')!;
beforeEach(() => { installChromeMock(); document.body.innerHTML = '<div id="app"></div>'; });
afterEach(() => act(() => void render(null, document.querySelector('#app')!)));

it('shows a square icon-only More control with its existing accessible name and title', async () => {
  await mount();
  expect(more().textContent).toBe('');
  expect(more().style.aspectRatio).toBe('1');
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
it('keeps nine controls on a dedicated row, scales only this row and uses the shared menu width', async () => {
  await mount();
  const row=document.querySelector<HTMLElement>('[data-main-icons]')!;
  expect(row.querySelectorAll(':scope > button')).toHaveLength(9);
  expect(row.style.display).toBe('grid'); expect(row.style.gridTemplateColumns).toMatch(/repeat\(9,\s*1fr\)/);
  expect(more().style.aspectRatio).toBe('1');expect(more().style.width).toBe('100%');expect(more().style.minWidth).toBe('0');
  expect(more().style.borderStyle).toBe('dashed');
  const css = readFileSync('static/manager.css', 'utf8');
  expect(css).toContain('.menu-wide{min-width:min(300px,calc(100vw - 16px));max-width:min(340px,calc(100vw - 16px))}');
  expect(readFileSync('node_modules/@tabler/icons-webfont/dist/tabler-icons.min.css', 'utf8')).toContain('.ti-dots:before');
});
