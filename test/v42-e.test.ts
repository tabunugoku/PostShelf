import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadMessages } from './chrome-mock';
describe('v42-E: documented snapshot contract', () => {
  it('documents the optional fields and forbids operating translation buttons', () => {
    const doc = readFileSync('CLAUDE.md', 'utf8'); expect(doc.slice(doc.indexOf('## データモデル'), doc.indexOf('## 守ること'))).toMatch(/省略.*quote.*translated/);
    expect(doc).toContain('翻訳のボタン (「翻訳を表示」「原文を表示」) は押さない。原文は取らず、翻訳済みの印だけを保存する');
  });
  it('records manual verification and the limited quote scope', () => {
    const doc = readFileSync('docs/MANUAL_TEST.md', 'utf8'); const section = doc.slice(doc.indexOf('## v42'));
    expect(section).toContain('実機未確認'); for (const word of ['タイムライン', '詳細ページ', '自動取り込み', 'キャッシュ', '検索', '動画', 'textContent', '翻訳済み', '古い', '書き出し', '読み込み']) expect(section).toContain(word);
  });
  it('has an exact eight-language table for the three added labels', () => {
    const doc = readFileSync('docs/V42_TRANSLATIONS.md', 'utf8');
    for (const lang of ['ja', 'en', 'zh_CN', 'zh_TW', 'ko', 'es', 'pt_BR', 'fr']) for (const key of ['translatedBadge', 'quoteLabel', 'quoteAsSeen']) {
      expect(doc).toContain(lang); expect(doc).toContain(key); expect(doc).toContain(loadMessages(lang)[key].message);
    }
  });
});
