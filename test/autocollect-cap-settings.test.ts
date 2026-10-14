// 版: v49-a
import { beforeEach, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import {
  CAP_MAX, getCollectRun, getSettings, normalizeCap, peekCollectCommand, saveCollectRun, sendCollectCommand, updateAutoCollect,
} from '../src/shared/settings';

beforeEach(() => {
  installChromeMock();
});

it.each([
  [0, 0],
  [1, 1],
  [7, 7],
  [CAP_MAX, CAP_MAX],
  [CAP_MAX + 1, 300],
  [-1, 300],
  [1.5, 300],
  ['300', 300],
  [NaN, 300],
  [undefined, 300],
  [null, 300],
])('normalizeCap(%j) is %j', (input, expected) => {
  expect(normalizeCap(input)).toBe(expected);
});

it('keeps an arbitrary cap in the settings, the run state and the command', async () => {
  await updateAutoCollect({ cap: 7 });
  expect((await getSettings()).autoCollect.cap).toBe(7);
  await saveCollectRun({
    status: 'paused', accountId: 'me', startedAt: 1, imported: 5, skipped: 0, failed: 0, speed: 'slow', cap: 7, updatedAt: 2,
  });
  expect((await getCollectRun())!.cap).toBe(7);
  await sendCollectCommand({ type: 'start', consent: true, speed: 'slow', cap: 7, accountId: 'me' });
  expect((await peekCollectCommand())!.cap).toBe(7);
});

it('falls back to 300 for an invalid cap in all three places', async () => {
  await updateAutoCollect({ cap: 1.5 });
  expect((await getSettings()).autoCollect.cap).toBe(300);
  await saveCollectRun({
    status: 'paused', accountId: 'me', startedAt: 1, imported: 5, skipped: 0, failed: 0, speed: 'slow', cap: -1, updatedAt: 2,
  });
  expect((await getCollectRun())!.cap).toBe(300);
  await sendCollectCommand({ type: 'start', consent: true, speed: 'slow', cap: CAP_MAX + 1, accountId: 'me' });
  expect((await peekCollectCommand())!.cap).toBe(300);
});
