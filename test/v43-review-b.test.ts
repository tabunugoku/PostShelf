import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadMessages } from './chrome-mock';
it('uses the standard Japanese parentheses and a clear speed description, without exceptions',()=>{
 const d=loadMessages('ja');expect(d.fullTextSpeedSlow.message).toBe('ゆっくり（おすすめ）');expect(d.fullTextSpeedDesc.message).toBe('速くするほど、X に制限されやすくなります。');
 for(const v of Object.values(d))expect(v.message).not.toMatch(/[()]/);
 expect(readFileSync('test/i18n.test.ts','utf8')).not.toContain("if (k === 'fullTextSpeedSlow')");
});
it.each(['ja','en','zh_CN','zh_TW','ko','es','pt_BR','fr'])('%s switch and confirmation avoid fixed seconds and preserve placeholders',lang=>{
 const d=loadMessages(lang),en=loadMessages('en');for(const key of ['fullTextSwitchDesc','fullTextConfirm']){expect(d[key].message).not.toMatch(/4\s*(?:[〜～~–-]|a|à)\s*8/);expect(d[key].placeholders).toEqual(en[key].placeholders);}
 expect(d.fullTextConfirm.message).toContain('$COUNT$');
});
