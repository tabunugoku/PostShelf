// 版: v62-d
import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const languages = ['ja', 'en', 'zh_CN', 'zh_TW', 'ko', 'es', 'pt_BR', 'fr'];

it.each(languages)('%s の補足文は V62 の案どおりで、注意を 1 文だけ足している', (language) => {
  expect(existsSync('docs/V62_TRANSLATIONS.md')).toBe(true);
  const table = readFileSync('docs/V62_TRANSLATIONS.md', 'utf8');
  const header = table.split(/\r?\n/).find((line) => line.startsWith('| キー |'))!;
  expect(header.split('|').map((cell) => cell.trim()).slice(2, -1)).toEqual(languages);
  const row = table.split(/\r?\n/).find((line) => line.startsWith('| showInAncestorsDesc |'))!;
  const proposal = row.split('|')[languages.indexOf(language) + 2].trim();
  const locale = JSON.parse(readFileSync(`static/_locales/${language}/messages.json`, 'utf8'));
  // v63 で案を採用したので、文言は案と一致する。
  expect(locale.showInAncestorsDesc.message).toBe(proposal);
  if (language === 'ja') {
    expect(proposal.endsWith('親と子の両方に直接入れたポストは、子にだけ表示されます。')).toBe(true);
  }
  expect(proposal).not.toMatch(/\$[A-Z_]+\$/);
});
