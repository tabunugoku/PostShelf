import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/manager/App';
import { SettingsPage, filterSettings } from '../src/manager/Settings';
import { pickMenuSide } from '../src/manager/ui';
import { highlightRanges, searchTerms } from '../src/shared/highlight';
import { queryBookmarks } from '../src/shared/query';
import { noteAccount, setAccountScope, createFolder, setBookmarkFolders } from '../src/shared/storage';
import { t } from '../src/shared/strings';
import { installChromeMock, installPanelMock } from './chrome-mock';
import type { Bookmark } from '../src/shared/models';

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 30)));
beforeEach(() => {
  installChromeMock();
  installPanelMock();
  setAccountScope('unknown');
  history.replaceState(null, '', '/');
  document.body.innerHTML = '<div id="app"></div>';
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(async () => {
  await act(() => void render(null, document.querySelector('#app')!));
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

it('highlights the whole normalized phrase with the same spacing as list filtering', () => {
  const q = '  ＡＢ cＤ  ';
  const terms = searchTerms(q);
  expect(terms).toEqual(['ab cd']);
  expect(highlightRanges('AB elsewhere CD; ＡＢ cＤ', terms)).toEqual([[17, 22]]);
  expect(highlightRanges('AB  CD', terms)).toEqual([]);
  expect(searchTerms(' \t\n ')).toEqual([]);
  const posts: Bookmark[] = ['AB elsewhere CD', 'ＡＢ cＤ', 'AB  CD'].map((text, i) => ({ accountId: 'unknown', tweetId: String(i), folderIds: ['inbox'], savedAt: i, snapshot: { text, author: 'Sample', handle: '@sample_user', media: [], url: `https://x.com/sample_user/status/${i}` } }));
  expect(queryBookmarks(posts, { folderId: 'all', search: q, sort: 'savedDesc' }).map((b) => b.tweetId)).toEqual(['1']);
});

it.each(['empty', 'classified'])('#triage shows triageDone with zero inbox posts (%s)', async (data) => {
  await noteAccount({ handle: 'me' });
  setAccountScope('me');
  if (data === 'classified') {
    const f = await createFolder({ name: 'Sample' });
    await setBookmarkFolders('111', [f.id], { text: 'sample post', author: 'Sample', handle: '@sample_user', media: [], url: 'https://x.com/sample_user/status/111' });
  }
  history.replaceState(null, '', '/#triage');
  await act(() => void render(<App />, document.querySelector('#app')!));
  for (let i = 0; i < 3; i++) await flush();
  const dialog = document.querySelector('[role=dialog].triage');
  expect(dialog?.querySelector('h2')?.textContent).toBe(t('triageDone'));
  expect(dialog?.querySelector('[role=status]')?.textContent).toBe(t('triageDoneSub', 0));
  await act(() => void dialog!.querySelector<HTMLButtonElement>('button')!.click());
  expect(document.querySelector('[role=dialog].triage')).toBeNull();
});

it('matches settings chips by group identity even when headings have identical text', () => {
  const root = document.createElement('section');
  root.innerHTML = '<nav class="settings-nav"><button class="nav-chip" data-group="save">Same heading</button><button class="nav-chip" data-group="collect">Same heading</button></nav><h3 class="set-h" data-group="save">Same heading</h3><fieldset class="setting-group"><div class="setting">alpha only</div></fieldset><h3 class="set-h" data-group="collect">Same heading</h3><fieldset class="setting-group"><div class="setting">beta only</div></fieldset>';
  expect(filterSettings(root, 'beta')).toBe(1);
  const chips = [...root.querySelectorAll<HTMLButtonElement>('.nav-chip')];
  expect(chips.map((c) => c.hidden)).toEqual([true, false]);
  filterSettings(root, '');
  expect(chips.map((c) => c.hidden)).toEqual([false, false]);
});

it('renders matching data-group attributes on every settings chip and heading', async () => {
  await act(() => void render(<SettingsPage onChanged={() => {}} onApplied={() => {}} onNotice={() => {}} />, document.querySelector('#app')!));
  await flush();
  const chips = [...document.querySelectorAll<HTMLElement>('.nav-chip')];
  const heads = [...document.querySelectorAll<HTMLElement>('.set-h')];
  expect(chips.map((c) => c.dataset.group)).toEqual(['save', 'collect', 'behavior', 'data', 'info', 'reset']);
  expect(heads.map((h) => h.dataset.group)).toEqual(chips.map((c) => c.dataset.group));
});

it('reuses sentence segmenters across components and rerenders for each language', async () => {
  vi.resetModules();
  const { Sentences } = await import('../src/manager/ui');
  const Original = Intl.Segmenter;
  const construct = vi.spyOn(Intl, 'Segmenter').mockImplementation(function (locale, options) { return new Original(locale, options); });
  for (const lang of ['ja', 'en']) {
    document.documentElement.lang = lang;
    for (const text of ['First sentence. Second sentence.', 'Changed sentence. Last sentence.']) {
      await act(() => void render(<><Sentences text={text} /><Sentences text={text} /></>, document.querySelector('#app')!));
      expect(document.querySelectorAll('.desc-line')).toHaveLength(4);
    }
  }
  expect(construct.mock.calls.map(([locale]) => locale)).toEqual(['ja', 'en']);
});

it('caches a sentence-constructor failure and keeps the fallback output', async () => {
  vi.resetModules();
  const { splitSentences } = await import('../src/manager/ui');
  const construct = vi.spyOn(Intl, 'Segmenter').mockImplementation(() => { throw new RangeError('unsupported locale'); });
  expect(splitSentences('一文目。二文目。', 'invalid_locale')).toEqual(['一文目。', '二文目。']);
  expect(splitSentences('三文目。四文目。', 'invalid_locale')).toEqual(['三文目。', '四文目。']);
  expect(construct).toHaveBeenCalledTimes(1);
});

it('decides menu alignment from the right edge without evaluating the redundant left-edge condition', () => {
  const left = vi.fn(() => 8);
  expect(pickMenuSide({ get left() { return left(); }, right: 100 }, 160, 320)).toBe('left');
  expect(left).not.toHaveBeenCalled();
});
