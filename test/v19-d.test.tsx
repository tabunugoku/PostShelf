import { act } from 'preact/test-utils';
import { render } from 'preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { AutoCollectDialog } from '../src/manager/AutoCollect';
import { AutoCollectPanel, viewOf } from '../src/content/autocollectPanel';
import type { AutoCollector, CollectState } from '../src/content/autocollect';

const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends Element>(sel: string) => [...document.querySelectorAll<T>(sel)];
const stub = () => ({ pause: vi.fn(), stop: vi.fn(), resume: vi.fn(), resumeLater: vi.fn(), dismiss: vi.fn() }) as unknown as AutoCollector;
const st = (o: Partial<CollectState> = {}): CollectState => ({
  status: 'running', accountId: 'me', startedAt: 1, imported: 5, skipped: 1, failed: 0, speed: 'slow', cap: 300, updatedAt: 1, ...o,
});

beforeEach(() => {
  installChromeMock();
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, '', '/i/history');
});

describe('v19-小: 自動取り込みの停止ボタンは、赤くしない', () => {
  it('the 停止 button in the running panel has the same border and text colors as the other buttons; no button in the view is marked danger', () => {
    expect(viewOf(st()).buttons.some((b) => b.danger)).toBe(false);
    new AutoCollectPanel(stub(), () => {}).update(st());
    const [pause, stop] = $$<HTMLElement>('.postshelf-autocollect-panel button');
    expect(stop.textContent).toBe('停止');
    expect(stop.style.borderColor).toBe(pause.style.borderColor);
    expect(stop.style.color).toBe(pause.style.color);
  });
});

describe('v19-小: 確認ダイアログの順', () => {
  it('説明 → 規約の注意 (黄色い枠) → 速度と 1 回の上限 → 並び順の図 → 同意 → 始める', async () => {
    await act(() => void render(<AutoCollectDialog accountName="@me" speed="slow" cap={300} onCancel={() => {}} onStart={() => {}} />, $('#app')));
    const kids = [...$('.ac-dialog').children].map((c) => c.className.split(' ')[0] || c.tagName.toLowerCase());
    const at = (sel: string) => [...$('.ac-dialog').children].findIndex((c) => c.matches(sel));
    const order = [at('h2'), at('p.muted'), at('.ac-alert'), at('fieldset.ac-field'), at('label.ac-cap'), at('.ac-order'), at('label.setting'), at('.dialog-actions')];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(kids).toBeTruthy();
  });
});
