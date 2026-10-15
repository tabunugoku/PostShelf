// 版: v45-d
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// v45 の項目は実機で確かめ終え、MANUAL_TEST の末尾のアーカイブへ移した
it('keeps the v45 media backfill scenarios in the archive as verified', () => {
  const doc = readFileSync('docs/MANUAL_TEST.md', 'utf8');
  const section = doc.split('### 完了: 画像・動画サムネイルの読み取りと保存済みメディアの補完')[1]?.split('\n### ')[0];
  expect(section).toBeDefined();
  const labels = ['最初の1回', '拡大ビュー', '過去の版', 'サムネイル', '画像も動画もない', '速さ', 'スクロール', '本文・フォルダ・savedAt・引用・翻訳'];
  for (const label of labels) {
    expect(section).toContain(label);
  }
  const lines = section!.split('\n');
  expect(lines.filter((line) => line.startsWith('- [x]')).length).toBeGreaterThanOrEqual(6);
  expect(lines.some((line) => line.startsWith('- [ ]'))).toBe(false);
});
