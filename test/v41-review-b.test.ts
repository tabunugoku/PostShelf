import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFolderMenu } from '../src/shared/folderCreateMenu';
import { createFolderPicker } from '../src/shared/folderPicker';
import { MAIN_ICONS, MORE_ICONS, iconLabel } from '../src/shared/models';
import * as storage from '../src/shared/storage';
import { t } from '../src/shared/strings';
import { installChromeMock } from './chrome-mock';

const theme = { fg: '#000', border: '#ccc', hover: '#eee', accent: '#06c' };
const tick = () => new Promise(r => setTimeout(r, 20));
beforeEach(() => { installChromeMock(); storage.setAccountScope('unknown'); document.body.innerHTML = ''; });
afterEach(() => vi.restoreAllMocks());
const mount = (onCreated: Parameters<typeof createFolderMenu>[0]['onCreated'] = () => {}) => {
  const menu = createFolderMenu({ theme, existing: () => [], onCreated, onClose: () => {} });
  document.body.append(menu.el); return menu;
};
const more = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('[data-icon-more]')!;
const grid = (el: HTMLElement) => el.querySelector<HTMLElement>('[data-more-icons]')!;
const inputName = (el: HTMLElement) => {
  const input = el.querySelector('input')!; input.value = 'Sample created'; input.dispatchEvent(new Event('input'));
};
const submit = async (el: HTMLElement) => { el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await tick(); };

it('shows eight main icons plus icon-only More and a 36-button nine-column grid', () => {
  const { el } = mount(); const button = more(el);
  expect(button.textContent).toBe(''); expect(button.title).toBe(t('iconMore'));
  expect(button.getAttribute('aria-label')).toBe(t('iconMore'));
  expect(button.querySelector('i')?.className).toContain('ti-dots');
  expect(button.style.borderStyle).toBe('dashed');
  expect(button.parentElement?.children).toHaveLength(9);
  expect(button.parentElement?.style.gridTemplateColumns).toMatch(/repeat\(9,\s*1fr\)/);
  expect(grid(el).hidden).toBe(true); button.click();
  expect(button.getAttribute('aria-expanded')).toBe('true'); expect(grid(el).hidden).toBe(false);
  expect(grid(el).previousElementSibling).toBe(button.parentElement);
  expect(grid(el).style.gridTemplateColumns).toMatch(/repeat\(9,\s*1fr\)/);
  const buttons = [...grid(el).querySelectorAll<HTMLButtonElement>('button')];
  expect(buttons.map(b => b.dataset.icon)).toEqual([...MORE_ICONS]);
  expect(buttons.map(b => b.getAttribute('aria-label'))).toEqual(MORE_ICONS.map(iconLabel));
  expect(buttons.every(b => b.hasAttribute('aria-pressed'))).toBe(true);
  button.click(); expect(grid(el).hidden).toBe(true);
});

it('selects an extra icon, updates preview and More, restores focus, then creates with it', async () => {
  const { el } = mount(); inputName(el); const create = vi.spyOn(storage, 'createFolder');
  more(el).click(); grid(el).querySelector<HTMLButtonElement>('[data-icon="ti-cat"]')!.click();
  expect(grid(el).hidden).toBe(true); expect(document.activeElement).toBe(more(el));
  expect(more(el).getAttribute('aria-pressed')).toBe('true');
  expect(more(el).getAttribute('aria-label')).toBe(`${t('iconMore')}: ${iconLabel('ti-cat')}`);
  expect(more(el).querySelector('i')?.className).toContain('ti-cat');
  expect(el.querySelector('[aria-hidden=true] i')?.className).toContain('ti-cat');
  await submit(el); expect(create).toHaveBeenCalledExactlyOnceWith({ name: 'Sample created', icon: 'ti-cat', color: undefined });
});

it('returns More to dots when a main icon is selected', async () => {
  const { el } = mount(); more(el).click(); grid(el).querySelector<HTMLButtonElement>('button')!.click();
  el.querySelector<HTMLButtonElement>(`[data-main-icons] [data-icon="${MAIN_ICONS[1]}"]`)!.click();
  expect(more(el).querySelector('i')?.className).toContain('ti-dots');
  expect(more(el).getAttribute('aria-pressed')).toBe('false'); inputName(el);
  const create = vi.spyOn(storage, 'createFolder'); await submit(el);
  expect(create).toHaveBeenCalledExactlyOnceWith({ name: 'Sample created', icon: MAIN_ICONS[1], color: undefined });
});

it('can create while the extra grid is open and resets all selection and expansion', async () => {
  const menu = mount(); inputName(menu.el); more(menu.el).click();
  await submit(menu.el); expect((await storage.listFolders()).find(f => f.name === 'Sample created')?.icon).toBe('ti-folder');
  menu.reset(); expect(grid(menu.el).hidden).toBe(true);
  expect(more(menu.el).getAttribute('aria-expanded')).toBe('false');
  expect(menu.el.querySelector('input')?.value).toBe('');
});

it('disables More and the grid for retrying a created folder and unlocks them on reset', async () => {
  const menu = mount(() => false); inputName(menu.el); more(menu.el).click(); await submit(menu.el);
  expect(more(menu.el).disabled).toBe(true);
  expect([...grid(menu.el).querySelectorAll<HTMLButtonElement>('button')].every(b => b.disabled)).toBe(true);
  menu.reset(); expect(more(menu.el).disabled).toBe(false); expect(grid(menu.el).hidden).toBe(true);
  expect([...grid(menu.el).querySelectorAll<HTMLButtonElement>('button')].every(b => !b.disabled)).toBe(true);
});

it.each(['Escape', 'back'])('reopens a picker creation menu without stale expansion after %s', async method => {
  const picker = createFolderPicker({ folders: [], selected: new Set(), theme, onChange: () => {} }); document.body.append(picker.el);
  const add = () => [...picker.el.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === t('addFolder'))!;
  add().click(); const form = picker.el.querySelector('form')!; more(form).click();
  if (method === 'Escape') more(form).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  else [...form.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === `← ${t('back')}`)!.click();
  add().click(); expect(grid(form).hidden).toBe(true); expect(more(form).getAttribute('aria-expanded')).toBe('false');
});
