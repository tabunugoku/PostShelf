import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const languages = ['ja', 'en', 'zh_CN', 'zh_TW', 'ko', 'es', 'pt_BR', 'fr'];

it.each(languages)('%s の補足案は既存の文言を残し、注意を 1 文だけ足す', (language) => {
  expect(existsSync('docs/V62_TRANSLATIONS.md')).toBe(true);
  const table = readFileSync('docs/V62_TRANSLATIONS.md', 'utf8');
  const header = table.split(/\r?\n/).find((line) => line.startsWith('| キー |'))!;
  expect(header.split('|').map((cell) => cell.trim()).slice(2, -1)).toEqual(languages);
  const row = table.split(/\r?\n/).find((line) => line.startsWith('| showInAncestorsDesc |'))!;
  const proposal = row.split('|')[languages.indexOf(language) + 2].trim();
  const locale = JSON.parse(readFileSync(`static/_locales/${language}/messages.json`, 'utf8'));
  const original: string = locale.showInAncestorsDesc.message;
  expect(proposal.startsWith(original)).toBe(true);
  const addition = proposal.slice(original.length).trim();
  expect(addition.split(/[。.]/).filter((part) => part.trim())).toHaveLength(1);
  expect(addition).toMatch(/[。.]$/);
  if (language === 'ja') {
    expect(addition).toBe('親と子の両方に入れたポストは、子にだけ表示されます。');
  }
  expect(proposal).not.toMatch(/\$[A-Z_]+\$/);
});
