import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('documents v45 media backfill scenarios as unverified on real devices', () => {
  const doc = readFileSync('docs/MANUAL_TEST.md','utf8');
  const section = doc.split('## v45:')[1];
  expect(section).toBeDefined();
  for (const label of ['最初の1回','拡大ビュー','過去の版','サムネイル','画像も動画もない','速さ','スクロール','本文・フォルダ・savedAt・引用・翻訳']) expect(section).toContain(label);
  const checks = section.split(String.fromCharCode(10)).filter(line => line.startsWith('- [ ]'));
  expect(checks.length).toBeGreaterThanOrEqual(6);
  expect(checks.every(line => line.includes('実機未確認'))).toBe(true);
});
