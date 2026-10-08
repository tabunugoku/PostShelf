import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extensionIdFromKey, idFromDoc } from '../scripts/lib.mjs';
import { checkKeyId } from '../scripts/checks.mjs';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const manifest = JSON.parse(read('static/manifest.json'));
const id = extensionIdFromKey(manifest.key);

describe('v13-D: install docs', () => {
  it('the extension ID written in the docs is the one computed from the manifest key', () => {
    expect(idFromDoc(read('docs/INSTALL.md'))).toBe(id);
    expect(checkKeyId(manifest, read('docs/INSTALL.md'))).toEqual([]);
    for (const f of ['docs/INSTALL.en.md', 'docs/PUBLISH.md']) expect(read(f)).toContain(`\`${id}\``);
  });
  it('INSTALL.md covers first install, update (never remove), the one-time switch, the Chrome prompt and troubleshooting', () => {
    const ja = read('docs/INSTALL.md');
    for (const s of ['デベロッパーモード', 'パッケージ化されていない拡張機能を読み込む', 'ピン留め', '同じフォルダ', '再読み込み', '削除', 'エクスポート', 'インポート', '1 回だけ', 'デベロッパーモードの拡張機能を無効にしますか', 'キャンセル', 'ID'])
      expect(ja).toContain(s);
    const en = read('docs/INSTALL.en.md');
    for (const s of ['Developer mode', 'Load unpacked', 'Reload', 'Export', 'Import', 'one time only', 'Cancel', 'Troubleshooting']) expect(en).toContain(s);
    // 起動時の確認は、断定しない書き方
    expect(ja).toContain('Chrome のバージョンによって');
  });
  it('PUBLISH.md is rewritten for manual installation and keeps the store items under a separate heading; the license is MIT', () => {
    const p = read('docs/PUBLISH.md');
    expect(p.indexOf('# リリースの手順') >= 0 || p.indexOf('## リリースの手順') >= 0).toBe(true);
    expect(p.indexOf('# いまは行わない (参考)')).toBeGreaterThan(p.indexOf('## リリースの手順'));
    expect(p.slice(p.indexOf('# いまは行わない (参考)'))).toContain('Chrome Web Store で「PostShelf」の同名拡張がないか');
    expect(p).toContain('MIT に決定済み');
    expect(p).toContain('MIT');
    expect(p).toContain('1.0.0');
  });
  it('the license is MIT: LICENSE exists, package.json says MIT, README states the scope and disclaimer', () => {
    expect(read('LICENSE')).toContain('MIT License');
    expect(JSON.parse(read('package.json')).license).toBe('MIT');
    const r = read('README.md');
    expect(r).toContain('## ライセンスと免責');
    expect(r).toContain('X との提携はありません');
  });
  it('README has an install section that points to INSTALL.md', () => {
    expect(read('README.md')).toMatch(/## インストール[\s\S]*docs\/INSTALL\.md/);
  });
});
