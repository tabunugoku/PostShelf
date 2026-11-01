// 版: v84
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Card, type RowHandlers } from '../src/manager/Cards';
import { refreshCacheView } from '../src/manager/cacheView';
import type { Bookmark } from '../src/shared/models';
import { installChromeMock } from './chrome-mock';

let host: HTMLDivElement;
let bookmark: Bookmark;
let handlers: RowHandlers;
const folderOf = () => undefined;
const mount = async (compact = false, selected = false) => {
  await act(() => void render(
    <Card
      b={bookmark}
      view="post"
      compact={compact}
      selected={selected}
      selectionActive={false}
      tabbable
      folderOf={folderOf}
      pickerOpen={false}
      pickerNode={null}
      h={handlers}
    />,
    host,
  ));
};
const before = (first: Element, second: Element) => {
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
};
const click = async (element: Element) => {
  await act(() => void element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
};

beforeEach(async () => {
  installChromeMock();
  await refreshCacheView();
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
  bookmark = {
    accountId: 'me', tweetId: '111', savedAt: 1, folderIds: [],
    snapshot: {
      author: '架空の投稿者', handle: '@sample_author', text: '図を添えた架空の本文',
      url: 'https://x.com/sample_author/status/111',
      media: ['https://example.invalid/own-1.jpg', 'https://example.invalid/own-2.jpg'],
      quote: {
        author: '架空の引用元', handle: '@sample_quote', text: '引用元の架空の本文',
        url: 'https://x.com/sample_quote/status/222', media: ['https://example.invalid/quote.jpg'],
      },
    },
  };
  handlers = {
    select: vi.fn(), focus: vi.fn(), removeFromFolder: vi.fn(), togglePicker: vi.fn(),
    del: vi.fn(), dragStart: vi.fn(), openImage: vi.fn(), openVideo: vi.fn(),
  };
});

afterEach(() => {
  render(null, host);
  vi.restoreAllMocks();
});

it.each([false, true])('本文、自分の画像 2 枚、引用元、チップの順に出す (狭い表示 %s)', async compact => {
  await mount(compact);
  const article = host.querySelector('article')!;
  const media = article.querySelector('.post-body > .media')!;
  const quote = article.querySelector('.quote-block')!;
  before(article.querySelector('.post-head')!, article.querySelector('.post-text')!);
  before(article.querySelector('.post-text')!, media);
  before(media, quote);
  before(quote, article.querySelector('.act')!);
  expect([...media.querySelectorAll('img')].map(image => image.src)).toEqual(bookmark.snapshot.media);
  expect([...quote.querySelectorAll('.media img')].map(image => (image as HTMLImageElement).src))
    .toEqual(bookmark.snapshot.quote!.media);
});

it('自分の動画タイルも引用元より前に出す', async () => {
  bookmark.snapshot.hasVideo = true;
  bookmark.snapshot.videoPoster = 'https://example.invalid/own-video.jpg';
  await mount();
  const video = host.querySelector('.post-body > .media .ph.v')!;
  before(video, host.querySelector('.quote-block')!);
  await click(video);
  expect(handlers.openVideo).toHaveBeenCalledExactlyOnceWith('111');
  expect(handlers.openImage).not.toHaveBeenCalled();
});

it.each(['images', 'video', 'quote', 'text'] as const)('%s だけのポストの順は従来どおり', async kind => {
  if (kind !== 'quote') delete bookmark.snapshot.quote;
  if (kind !== 'images') bookmark.snapshot.media = [];
  if (kind === 'video') bookmark.snapshot.hasVideo = true;
  await mount();
  const classes = [...host.querySelector('.post-body')!.children].map(element => element.classList[0]);
  const middle = kind === 'quote' ? ['quote-block'] : kind === 'text' ? [] : ['media'];
  expect(classes).toEqual(['post-head', 'post-text', ...middle, 'act']);
});

it('再描画で画像を使い回し、自分の画像の index と引用側の操作を保つ', async () => {
  await mount();
  const ownImages = [...host.querySelectorAll('.post-body > .media img')];
  const quoteImage = host.querySelector('.quote-block img')!;
  await mount(false, true);
  const repainted = host.querySelectorAll('.post-body > .media img');
  expect(repainted).toHaveLength(ownImages.length);
  ownImages.forEach((image, index) => expect(repainted[index]).toBe(image));
  expect(host.querySelector('.quote-block img')).toBe(quoteImage);
  const tiles = host.querySelectorAll('.post-body > .media .ph');
  await click(tiles[0]);
  await click(tiles[1]);
  expect(vi.mocked(handlers.openImage).mock.calls).toEqual([['111', 0], ['111', 1]]);
  vi.mocked(handlers.openImage).mockClear();
  await click(quoteImage);
  const quoteLink = host.querySelector<HTMLAnchorElement>('.quote-open')!;
  expect(quoteLink.href).toBe(bookmark.snapshot.quote!.url);
  await click(quoteLink);
  expect(handlers.openImage).not.toHaveBeenCalled();
  expect(handlers.openVideo).not.toHaveBeenCalled();
  expect(handlers.select).not.toHaveBeenCalled();
});
