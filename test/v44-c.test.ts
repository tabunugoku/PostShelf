import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('documents the v44 confirmation, dismissal and toast checks as unverified on both surfaces', () => {
  const manual = readFileSync('docs/MANUAL_TEST.md', 'utf8');
  const start = manual.indexOf('## v44:');
  expect(start).toBeGreaterThanOrEqual(0);
  const section = manual.slice(start);
  for (const text of ['未分類', '最初のフォルダ', 'すべて外して', 'メニューが閉じない', '確定ボタン', 'Enter', 'Esc', '戻る', '外側クリック', '保存されない', '中間', '再試行', '元に戻す', 'toastMoved', 'toastAdded', 'toastRemoved', 'サイドパネル']) {
    expect(section).toContain(text);
  }
  const checks = section.split(/\r?\n/).filter(line => line.startsWith('- [ ]'));
  expect(checks.length).toBeGreaterThanOrEqual(6);
  for (const check of checks) expect(check).toContain('実機未確認');
});
