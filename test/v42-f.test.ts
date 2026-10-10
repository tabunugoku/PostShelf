import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock';
import { getBookmark, importData, setAccountScope } from '../src/shared/storage';
const quote = { author: 'Sample Quote', handle: '@sample_quote', text: 'Sample quote body', media: ['https://example.invalid/valid.jpg'], avatar: 'https://example.invalid/avatar.jpg', url: 'https://x.com/sample_quote/status/333' };
const load = async (patch: object) => {
  expect(await importData({ app: 'PostShelf', version: 2, folders: [], bookmarks: [{ accountId: 'me', tweetId: '111', savedAt: 1, folderIds: [], snapshot: { author: 'Sample Main', handle: '@sample_main', text: 'Sample main body', media: [], url: 'https://x.com/sample_main/status/111', quote: { ...quote, ...patch } } }] })).toBe(1);
  return (await getBookmark('111'))!.snapshot;
};
beforeEach(() => { installChromeMock(); setAccountScope('me'); });
describe('v42-F: quote images follow main-image HTTPS policy', () => {
  it.each(['http://example.invalid/insecure.jpg', 'javascript:alert(1)', 'data:image/png,x', 5])('drops only invalid media element %j', async invalid => {
    const s = await load({ media: [invalid, ...quote.media] }); expect(s.quote).toEqual(quote); expect(s.text).toBe('Sample main body');
  });
  it.each(['http://example.invalid/avatar.jpg', 'javascript:alert(1)', 'data:image/png,x', 5])('drops only invalid avatar %j', async avatar => {
    const s = await load({ avatar }); const { avatar: _, ...rest } = quote; expect(s.quote).toEqual(rest);
  });
  it('keeps quote even when all image elements are rejected', async () => {
    const s = await load({ media: ['http://example.invalid/insecure.jpg', null, {}] }); expect(s.quote).toEqual({ ...quote, media: [] });
  });
  it('continues to reject non-X post URLs by dropping quote alone', async () => {
    const s = await load({ url: 'https://example.invalid/post' }); expect(s.quote).toBeUndefined(); expect(s.text).toBe('Sample main body');
  });
});
