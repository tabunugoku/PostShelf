import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const read=(path:string)=>readFileSync(path,'utf8');
it('documents the default and standard plans without changing caps or stop rules',()=>{
 const policy=read('CLAUDE.md');
 expect(policy).toContain('既定は 4〜8 秒・1 タブ');expect(policy).toContain('2〜5 秒');expect(policy).toContain('1〜3 タブ');expect(policy).toContain('1 秒以上');
 expect(policy).toContain('X の制限は全タブを止める');expect(policy).toContain('連続 3 件の失敗は全タブで合算');
 expect(policy).toContain('自動取り込みでは 1 回 30 件');expect(policy).toContain('50 件');
});
it('keeps the source comment and plan in agreement with the worker behavior',()=>{
 const comment=read('src/background/fulltext.ts').split('*/')[0];
 expect(comment).not.toContain('同時に開く裏のタブは 1 つ');
 for(const word of ['既定','4〜8 秒','2〜5 秒','1〜3 タブ','1 秒以上','全タブ','合算','15 秒','1 時間']) expect(comment).toContain(word);
 expect(read('docs/PLAN.md')).toContain('2〜5 秒');
});
it('lists all v43 device checks as unverified and records all six translation keys',()=>{
 const manual=read('docs/MANUAL_TEST.md').split('## v43')[1];expect(manual).toBeTruthy();
 for(const word of ['ゆっくり','標準','2 タブ','3 タブ','1 秒','制限','止める','service worker','実機未確認'])expect(manual).toContain(word);
 const checks=manual.split('\n').filter(line=>line.startsWith('- [ ]'));expect(checks.length).toBeGreaterThanOrEqual(6);for(const line of checks)expect(line).toContain('実機未確認');
 const translations=read('docs/V43_TRANSLATIONS.md');for(const key of ['fullTextSpeed','fullTextSpeedSlow','fullTextSpeedStd','fullTextSpeedDesc','fullTextTabs','fullTextTabsN'])expect(translations).toContain('| '+key+' |');
});
