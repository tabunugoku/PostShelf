import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { extractTweet } from '../src/content/snapshot';
import { injectButtons, openPopover } from '../src/content/popover';
import { createFolder, getBookmark } from '../src/shared/storage';

const html = readFileSync(resolve(process.cwd(), 'test/fixtures/tweet.html'), 'utf8');

beforeEach(() => {
  installChromeMock();
  document.body.innerHTML = html;
});

describe('extractTweet', () => {
  it('builds a snapshot from the fixture', () => {
    const r = extractTweet(document.querySelector('article')!)!;
    expect(r.tweetId).toBe('1234567890');
    expect(r.snapshot).toMatchObject({
      text: 'こんにちは 世界',
      author: '山田 太郎',
      handle: '@yamada',
      createdAt: '2026-10-01T12:00:00.000Z',
      url: 'https://x.com/yamada/status/1234567890',
      media: ['https://pbs.twimg.com/media/x.jpg'],
    });
  });

  it('returns null without a status link', () => {
    document.body.innerHTML = '<article data-testid="tweet"></article>';
    expect(extractTweet(document.querySelector('article')!)).toBeNull();
  });
});

describe('popover', () => {
  it('injects one button next to the bookmark button, idempotently', () => {
    injectButtons();
    injectButtons();
    const btns = document.querySelectorAll('[data-postshelf-btn]');
    expect(btns.length).toBe(1);
    expect(btns[0].previousElementSibling?.getAttribute('data-testid')).toBe('bookmark');
  });

  it('saves a bookmark when a folder is checked and removes it when unchecked', async () => {
    const f = await createFolder({ name: '開発' });
    injectButtons();
    const pop = (await openPopover(document.querySelector('article')!, document.querySelector('[data-postshelf-btn]')!))!;
    const cb = pop.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 0));
    expect((await getBookmark('1234567890'))?.folderIds).toEqual([f.id]);
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 0));
    expect(await getBookmark('1234567890')).toBeUndefined();
  });

  it('creates a new folder from the popover and selects it', async () => {
    injectButtons();
    const pop = (await openPopover(document.querySelector('article')!, document.querySelector('[data-postshelf-btn]')!))!;
    pop.querySelector<HTMLInputElement>('form input')!.value = '新規';
    pop.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 10));
    expect((await getBookmark('1234567890'))?.folderIds.length).toBe(1);
    expect(pop.textContent).toContain('新規');
  });
});
