import { act } from 'preact/test-utils';
import { render } from 'preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { SettingsPage } from '../src/manager/Settings';
import { updateSettings } from '../src/shared/settings';

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 20)));

async function mount(surface: 'tab' | 'sidepanel' = 'tab') {
  document.body.innerHTML = '<div id="app"></div>';
  await act(() => void render(
    <SettingsPage surface={surface} onChanged={() => {}} onApplied={() => {}} onNotice={() => {}} />,
    document.getElementById('app')!,
  ));
  await flush();
}

/** details を開く。jsdom は summary のクリックで toggle を出さないので、open を立てて toggle を送る */
async function openDemo() {
  const details = document.querySelector<HTMLDetailsElement>('details.folder-demo')!;
  await act(() => {
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
  });
  await flush();
}

const press = async (label: string) => {
  const button = [...document.querySelectorAll<HTMLButtonElement>('.folder-demo-ops button')]
    .find((b) => b.textContent === label)!;
  await act(() => void button.click());
};
const textOf = (selector: string) => document.querySelector(selector)!.textContent!;
const names = (selector: string) => [...document.querySelectorAll(`${selector} .folder-demo-chip`)].map((e) => e.textContent);
const row = (id: string) => document.querySelector(`[data-demo-row="${id}"]`)!;
const status = (id: string) => row(id).querySelector('.folder-demo-status')!.textContent;

const OP = {
  save: '孫 G に保存',
  add: 'B にも入れる',
  uncheckChild: '子 C を外す',
  uncheckParent: '親 A を外す',
  move: 'C を B の下へ移す',
  del: 'フォルダ C を削除',
  reset: '最初に戻す',
};
const RES = {
  start: '「孫 G に保存」から試してください。',
  save: 'G を選ぶと、祖先の C と A にも保存されます。ポストに表示されるのは、いちばん下の G だけです。',
  noFolder: 'C はすでに削除されています。「最初に戻す」で元に戻せます。',
};

describe('v70: folder demo in settings', () => {
  beforeEach(() => {
    installChromeMock();
    (globalThis as any).chrome.tabs = { query: async () => [] };
  });

  it('is a closed details in the tab settings', async () => {
    await mount('tab');
    const details = document.querySelector<HTMLDetailsElement>('details.folder-demo')!;
    expect(details.querySelector('summary')!.textContent).toBe('親子のフォルダの動きを試す');
    expect(details.open).toBe(false);
    expect(details.querySelector('.folder-demo-body')).toBeNull();
  });

  it('is not shown in the side panel settings', async () => {
    await mount('sidepanel');
    expect(document.querySelector('details.folder-demo')).toBeNull();
  });

  it('starts as Unsorted with the start message', async () => {
    await mount();
    await openDemo();
    expect(names('[data-demo-stored]')).toEqual(['未分類']);
    expect(names('[data-demo-shown]')).toEqual(['未分類']);
    expect(textOf('[data-demo-result]')).toBe(RES.start);
  });

  it('saving to G stores A, C and G but shows only G', async () => {
    await mount();
    await openDemo();
    await press(OP.save);
    expect(names('[data-demo-stored]')).toEqual(['A', 'C', 'G']);
    expect(names('[data-demo-shown]')).toEqual(['G']);
    expect(textOf('[data-demo-result]')).toBe(RES.save);
  });

  it('adding B then unchecking C leaves A and B', async () => {
    await mount();
    await openDemo();
    await press(OP.save);
    await press(OP.add);
    expect(names('[data-demo-shown]')).toEqual(['G', 'B']);
    await press(OP.uncheckChild);
    expect(names('[data-demo-stored]')).toEqual(['A', 'B']);
    expect(names('[data-demo-shown]')).toEqual(['A', 'B']);
  });

  it('unchecking A after saving to G returns to Unsorted', async () => {
    await mount();
    await openDemo();
    await press(OP.save);
    await press(OP.uncheckParent);
    expect(names('[data-demo-stored]')).toEqual(['未分類']);
    expect(names('[data-demo-shown]')).toEqual(['未分類']);
    expect(status('inbox')).toBe('出る');
  });

  it('moving C under B takes the post out of A', async () => {
    await mount();
    await openDemo();
    await press(OP.save);
    await press(OP.add);
    await press(OP.move);
    expect(names('[data-demo-stored]')).toEqual(['B', 'C', 'G']);
    expect(status('A')).toBe('');
    const order = [...document.querySelectorAll('[data-demo-row]')].map((e) => e.getAttribute('data-demo-row'));
    expect(order).toEqual(['all', 'inbox', 'A', 'B', 'C', 'G']);
  });

  it('disables the move button once C is under B', async () => {
    await mount();
    await openDemo();
    await press(OP.move);
    const button = [...document.querySelectorAll<HTMLButtonElement>('.folder-demo-ops button')]
      .find((b) => b.textContent === OP.move)!;
    expect(button.disabled).toBe(true);
  });

  it('deleting C removes G too and keeps A', async () => {
    await mount();
    await openDemo();
    await press(OP.save);
    await press(OP.del);
    expect(row('C').textContent).toContain('C（削除済み）');
    expect(row('G').textContent).toContain('G（削除済み）');
    expect(names('[data-demo-stored]')).toEqual(['A']);
  });

  it('uses of the deleted folders change nothing and show the no-folder message', async () => {
    await mount();
    await openDemo();
    await press(OP.save);
    await press(OP.del);
    for (const op of [OP.save, OP.uncheckChild, OP.move, OP.del]) {
      await press(op);
      expect(textOf('[data-demo-result]')).toBe(RES.noFolder);
      expect(names('[data-demo-stored]')).toEqual(['A']);
    }
  });

  it('hides parent rows when the demo switch is off', async () => {
    await mount();
    await openDemo();
    await press(OP.save);
    const toggle = document.querySelector<HTMLInputElement>('.folder-demo-body input[role=switch]')!;
    expect(toggle.checked).toBe(true);
    for (const id of ['A', 'C', 'G']) expect(status(id)).toBe('出る');
    await act(() => void toggle.click());
    expect(status('A')).toBe('所属しているが出ない');
    expect(status('C')).toBe('所属しているが出ない');
    expect(status('G')).toBe('出る');
  });

  it('starts the demo switch from the setting and does not write it back', async () => {
    await updateSettings({ showInAncestors: false });
    await mount();
    await openDemo();
    expect(document.querySelector<HTMLInputElement>('.folder-demo-body input[role=switch]')!.checked).toBe(false);
  });

  it('never writes to chrome.storage', async () => {
    await mount();
    const chromeMock = (globalThis as any).chrome;
    // chrome.storage の、書き込みのあるすべての領域 (local・session など) を見張る
    const spies = Object.values(chromeMock.storage as Record<string, { set?: unknown }>)
      .filter((area) => typeof area?.set === 'function')
      .map((area) => vi.spyOn(area as { set: (...args: unknown[]) => unknown }, 'set'));
    expect(spies.length).toBeGreaterThan(0);
    await openDemo();
    for (const op of [OP.save, OP.add, OP.uncheckChild, OP.uncheckParent, OP.move, OP.del, OP.reset]) await press(op);
    const toggle = document.querySelector<HTMLInputElement>('.folder-demo-body input[role=switch]')!;
    await act(() => void toggle.click());
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('start over restores the first state and the demo switch', async () => {
    await mount();
    await openDemo();
    await press(OP.save);
    await press(OP.del);
    const toggle = document.querySelector<HTMLInputElement>('.folder-demo-body input[role=switch]')!;
    await act(() => void toggle.click());
    await press(OP.reset);
    expect(names('[data-demo-stored]')).toEqual(['未分類']);
    expect(textOf('[data-demo-result]')).toBe(RES.start);
    expect(row('C').textContent).not.toContain('削除済み');
    expect(document.querySelector<HTMLInputElement>('.folder-demo-body input[role=switch]')!.checked).toBe(true);
  });
});
