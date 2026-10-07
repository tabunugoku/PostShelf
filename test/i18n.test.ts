import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock, loadMessages } from './chrome-mock';
import { t, formatDate } from '../src/shared/strings';
import { ALL_FOLDER, displayName, INBOX_ID } from '../src/shared/models';
import { addCollected, listFolders } from '../src/shared/storage';

describe('locales', () => {
  it('ja and en have identical key sets and non-empty messages', () => {
    const ja = loadMessages('ja');
    const en = loadMessages('en');
    expect(Object.keys(en).sort()).toEqual(Object.keys(ja).sort());
    for (const d of [ja, en]) for (const v of Object.values(d)) expect(v.message.trim()).not.toBe('');
  });

  it('every t(...) key used in src and manifest __MSG_ exists', () => {
    const keys = new Set(Object.keys(loadMessages('ja')));
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(resolve(d, e.name)) : [resolve(d, e.name)],
      );
    const used = new Set<string>();
    for (const f of walk(resolve(process.cwd(), 'src'))) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\bt\('(\w+)'/g)) used.add(m[1]);
    }
    const manifest = readFileSync(resolve(process.cwd(), 'static/manifest.json'), 'utf8');
    for (const m of manifest.matchAll(/__MSG_(\w+)__/g)) used.add(m[1]);
    for (const k of used) expect(keys.has(k), k).toBe(true);
  });

  it('manifest uses default_locale en', () => {
    expect(JSON.parse(readFileSync(resolve(process.cwd(), 'static/manifest.json'), 'utf8')).default_locale).toBe('en');
  });
});

describe('t()', () => {
  it('resolves per language, with substitution', () => {
    installChromeMock('ja');
    expect(t('allFolderName')).toBe('すべて');
    expect(t('importDone', 3)).toBe('3 件のポストを取り込みました');
    installChromeMock('en');
    expect(t('allFolderName')).toBe('All');
    expect(t('importDone', 3)).toBe('Imported 3 posts');
  });
  it('formats dates by UI language', () => {
    installChromeMock('en');
    expect(formatDate('2026-10-01T12:00:00Z')).toBe('10/1/2026');
    installChromeMock('ja');
    expect(formatDate('2026-10-01T12:00:00Z')).toBe('2026/10/1');
  });
});

describe('built-in folder names follow the language', () => {
  it('"All" and the inbox are resolved at display time, not stored', async () => {
    installChromeMock('ja');
    expect(displayName(ALL_FOLDER)).toBe('すべて');
    await addCollected([{ tweetId: '1', snapshot: { text: '', author: '', handle: '', media: [], url: '' } }]);
    const inbox = (await listFolders()).find((f) => f.id === INBOX_ID)!;
    expect(inbox.name).toBe('');
    expect(displayName(inbox)).toBe('未分類');
    installChromeMock('en'); // 言語切替 (保存データは変えない)
    expect(displayName(ALL_FOLDER)).toBe('All');
    expect(displayName(inbox)).toBe('Unsorted');
  });
});
