import { act } from 'preact/test-utils';
import { render } from 'preact';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { AutoCollectDialog } from '../src/shared/AutoCollectDialog';

const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const press = (key: string, target: Element = document.body) =>
  act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
const type = async (keys: string, target?: Element) => {
  for (const k of keys) await press(k, target);
};
const capInput = () => document.querySelector<HTMLInputElement>('.ac-cap input[type=number]');
const startButton = () => $<HTMLButtonElement>('.dialog-actions .primary');
const setText = (input: HTMLInputElement, value: string) =>
  act(() => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const agree = () => act(() => void $<HTMLInputElement>('input[type=checkbox]').click());

let onStart: ReturnType<typeof vi.fn>;
const open = (cap = 300) => {
  onStart = vi.fn();
  return act(() => void render(
    <AutoCollectDialog accountName="@me" speed="slow" cap={cap} onCancel={() => {}} onStart={onStart} />,
    $('#app'),
  ));
};
beforeEach(() => {
  installChromeMock();
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => render(null, $('#app')));

it('shows no number input in the normal dialog', async () => {
  await open();
  expect(capInput()).toBeNull();
  expect($('.ac-cap select')).not.toBeNull();
});

it('toggles the number input by typing devcap', async () => {
  await open();
  await type('devcap');
  expect(capInput()).not.toBeNull();
  expect(capInput()!.value).toBe('300');
  expect(capInput()!.getAttribute('aria-label')).toBe('1 回の上限');
  await type('devcap');
  expect(capInput()).toBeNull();
});

it('does not count keys typed while a text input is focused', async () => {
  await open();
  await type('devcap');
  const input = capInput()!;
  await type('devcap', input);
  expect(capInput()).not.toBeNull();
});

it('starts counting again from the beginning when another key is typed in between', async () => {
  await open();
  await type('devxcap');
  expect(capInput()).toBeNull();
  await type('ddevcap');
  expect(capInput()).not.toBeNull();
});

it('disables the start button for an out-of-range or empty value', async () => {
  await open();
  await type('devcap');
  await agree();
  for (const bad of ['', '-1', '100001', '1.5']) {
    await setText(capInput()!, bad);
    expect(startButton().disabled).toBe(true);
  }
  await setText(capInput()!, '0');
  expect(startButton().disabled).toBe(false);
});

it('starts with the typed cap', async () => {
  await open();
  await type('devcap');
  await agree();
  await setText(capInput()!, '7');
  await act(() => void startButton().click());
  expect(onStart).toHaveBeenCalledWith('slow', 7);
});

it('shows a custom cap in the select without breaking the normal options', async () => {
  await open(7);
  const options = [...document.querySelectorAll('.ac-cap option')].map((o) => o.textContent);
  expect(options).toHaveLength(4);
  expect(options[3]).toBe('7');
  expect($<HTMLSelectElement>('.ac-cap select').value).toBe('7');
});

it('forgets the dev mode when the dialog is closed and opened again', async () => {
  await open();
  await type('devcap');
  expect(capInput()).not.toBeNull();
  await act(() => void render(null, $('#app')));
  await open();
  expect(capInput()).toBeNull();
});
