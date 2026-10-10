import { beforeEach, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import * as settings from '../src/shared/settings';
let data: Record<string, unknown>;
beforeEach(() => { data = installChromeMock(); });
it('defaults and missing values preserve slow, one-tab fetching', async () => {
  expect(settings.DEFAULT_SETTINGS).toMatchObject({ fullTextSpeed: 'slow', fullTextTabs: 1 });
  data.settings = { fullText: true };
  expect(await settings.getSettings()).toMatchObject({ fullTextSpeed: 'slow', fullTextTabs: 1 });
});
it.each([{}, {fullTextSpeed: 'fast', fullTextTabs: 0}, {fullTextSpeed: null, fullTextTabs: '3'}, {fullTextSpeed: true, fullTextTabs: 4}])('normalizes invalid or missing settings %j', async (raw) => {
  data.settings = raw;
  expect(await settings.getSettings()).toMatchObject({fullTextSpeed: 'slow', fullTextTabs: 1});
});
it.each([['slow', 1, 4000, 8000, 1], ['slow', 3, 4000, 8000, 1], ['standard', 1, 2000, 5000, 1], ['standard', 2, 2000, 5000, 2], ['standard', 3, 2000, 5000, 3]] as const)('plans %s with %i configured tabs', async (speed, tabs, min, max, effective) => {
  const s = await settings.updateSettings({fullTextSpeed: speed, fullTextTabs: tabs});
  expect(settings.fullTextPlan(s)).toEqual({ gapMinMs: min, gapMaxMs: max, tabs: effective });
  expect(await settings.getSettings()).toMatchObject({ fullTextSpeed: speed, fullTextTabs: tabs });
});
it('reset and undo include both settings', async () => {
  await settings.updateSettings({fullTextSpeed: 'standard', fullTextTabs: 3});
  const backup = await settings.resetSettings();
  expect(await settings.getSettings()).toMatchObject({fullTextSpeed: 'slow', fullTextTabs: 1});
  await settings.restoreSettings(backup);
  expect(await settings.getSettings()).toMatchObject({fullTextSpeed: 'standard', fullTextTabs: 3});
});
