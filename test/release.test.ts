import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crc32, extensionIdFromKey, idFromDoc, listZip, makeZip } from '../scripts/lib.mjs';
import {
  LOCALES, REQUIRED_HOST_PERMISSIONS, REQUIRED_PERMISSIONS, checkKeyId, checkLocales, checkManifestFilesInZip, checkNoRemoteCode, checkPermissions,
  checkVersion, manifestFiles,
} from '../scripts/checks.mjs';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const manifest = JSON.parse(read('static/manifest.json'));
const pkg = JSON.parse(read('package.json'));

describe('v13-C-1: fixed extension ID', () => {
  it('the manifest has a key that is a 2048-bit RSA public key (DER, base64)', () => {
    expect(typeof manifest.key).toBe('string');
    const pub = createPublicKey({ key: Buffer.from(manifest.key, 'base64'), format: 'der', type: 'spki' });
    expect(pub.asymmetricKeyType).toBe('rsa');
    expect(pub.asymmetricKeyDetails?.modulusLength).toBe(2048);
  });
  it('the ID is the first 128 bits of SHA-256(public key DER) mapped to a–p', () => {
    const hex = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32);
    const expected = [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
    expect(extensionIdFromKey(manifest.key)).toBe(expected);
    expect(expected).toMatch(/^[a-p]{32}$/);
    expect(idFromDoc(`拡張機能 ID: \`${expected}\``)).toBe(expected);
    expect(checkKeyId(manifest, `拡張機能 ID: \`${expected}\``)).toEqual([]);
  });
  it('the algorithm matches a freshly generated key (not just this one)', () => {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const der = publicKey.export({ type: 'spki', format: 'der' });
    const hex = createHash('sha256').update(der).digest('hex').slice(0, 32);
    expect(extensionIdFromKey(der.toString('base64'))).toBe([...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join(''));
  });
  it('adding the key did not change the permissions', () => {
    expect(manifest.permissions).toEqual(REQUIRED_PERMISSIONS);
    expect(manifest.host_permissions).toEqual(REQUIRED_HOST_PERMISSIONS);
    expect(checkPermissions(manifest)).toEqual([]);
  });
  it('a mismatching ID in the doc is reported', () => {
    expect(checkKeyId(manifest, '拡張機能 ID: `' + 'a'.repeat(32) + '`')).toHaveLength(1);
    expect(checkKeyId({ ...manifest, key: undefined }, '')).toHaveLength(1);
  });
});

describe('v13-C-3: release checks', () => {
  it('the manifest version equals package.json (1.1.2)', () => {
    expect(checkVersion(manifest, pkg)).toEqual([]);
    expect(manifest.version).toBe('1.1.2');
    expect(checkVersion({ ...manifest, version: '9.9.9' }, pkg)).toHaveLength(1);
  });
  it('an added permission fails the check', () => {
    expect(checkPermissions({ ...manifest, permissions: [...manifest.permissions, 'tabs'] })).toHaveLength(1);
    expect(checkPermissions({ ...manifest, host_permissions: [...manifest.host_permissions, 'https://pbs.twimg.com/*'] })).toHaveLength(1);
  });
  it('all 8 locales have the same keys and placeholders (and a broken one is reported)', () => {
    const all = Object.fromEntries(LOCALES.map((l: string) => [l, JSON.parse(read(`static/_locales/${l}/messages.json`))]));
    expect(LOCALES).toHaveLength(8);
    expect(checkLocales(all)).toEqual([]);
    const broken = structuredClone(all);
    delete broken.fr.importBanner;
    broken.ko.importBanner.message = '숫자 없음';
    expect(checkLocales(broken).length).toBeGreaterThanOrEqual(2);
  });
  it('remote code patterns are detected', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'ps-'));
    writeFileSync(join(dir, 'ok.js'), 'const u = "https://x.com/"; fetch(u);');
    expect(checkNoRemoteCode(dir)).toEqual([]);
    writeFileSync(join(dir, 'bad.js'), 'eval("1"); new Function("return 1"); s.src = "https://cdn.example.com/a.js";');
    writeFileSync(join(dir, 'bad.html'), '<script src="https://cdn.example.com/a.js"></script>');
    const errors = checkNoRemoteCode(dir);
    expect(errors.some((e: string) => e.startsWith('bad.js') && e.includes('eval'))).toBe(true);
    expect(errors.some((e: string) => e.startsWith('bad.js') && e.includes('new Function'))).toBe(true);
    expect(errors.some((e: string) => e.startsWith('bad.html'))).toBe(true);
    expect(errors.some((e: string) => e.startsWith('ok.js'))).toBe(false);
  });
  it('manifest files are checked against the zip entries', () => {
    const files = manifestFiles(manifest);
    expect(files).toEqual(expect.arrayContaining(['brand/icon-128.png', 'popup.html', 'background.js', 'content.js', 'sidepanel.html']));
    const names = ['manifest.json', '_locales/en/messages.json', 'brand/icon-16.png', 'brand/icon-32.png', 'brand/icon-48.png', 'brand/icon-128.png', 'popup.html', 'background.js', 'content.js', 'sidepanel.html', 'icons/tabler-icons.min.css', 'icons/fonts/a.woff2'];
    expect(checkManifestFilesInZip(manifest, names)).toEqual([]);
    expect(checkManifestFilesInZip(manifest, names.filter((n) => n !== 'brand/icon-48.png'))).toHaveLength(1);
    expect(checkManifestFilesInZip(manifest, [...names, 'content.js.map', 'node_modules/x/a.js'])).toHaveLength(2);
    expect(checkManifestFilesInZip(manifest, names.map((n) => `postshelf/${n}`))[0]).toContain('manifest.json'); // 直下に無い
  });
  it('the zip writer produces a valid archive (names, CRC, content)', async () => {
    const entries = [
      { name: 'manifest.json', data: Buffer.from('{"a":1}') },
      { name: '_locales/ja/messages.json', data: Buffer.from('日本語'.repeat(500)) },
    ];
    const zip = await makeZip(entries);
    expect(listZip(zip)).toEqual(['manifest.json', '_locales/ja/messages.json']);
    // 先頭のローカルヘッダーから読み戻す
    let p = 0;
    for (const e of entries) {
      expect(zip.readUInt32LE(p)).toBe(0x04034b50);
      const crc = zip.readUInt32LE(p + 14), csize = zip.readUInt32LE(p + 18), nlen = zip.readUInt16LE(p + 26);
      const body = inflateRawSync(zip.subarray(p + 30 + nlen, p + 30 + nlen + csize));
      expect(body.equals(e.data)).toBe(true);
      expect(crc).toBe(crc32(e.data));
      p += 30 + nlen + csize;
    }
    expect((await makeZip(entries)).equals(zip)).toBe(true); // 同じ入力から同じ zip
  });
  it('THIRD_PARTY_NOTICES.md names the bundled parts with their versions and license text, and the build copies it', () => {
    const n = read('THIRD_PARTY_NOTICES.md');
    expect(n).toContain('Preact');
    expect(n).toContain('Tabler Icons');
    expect(n).toContain(JSON.parse(read('node_modules/preact/package.json')).version);
    expect(n).toContain(JSON.parse(read('node_modules/@tabler/icons-webfont/package.json')).version);
    expect(n.match(/Permission is hereby granted/g)).toHaveLength(2);
    expect(read('build.mjs')).toContain('THIRD_PARTY_NOTICES.md');
  });
  it('release/ is ignored and the tag workflow runs release:check and attaches the zip', () => {
    expect(read('.gitignore')).toMatch(/^release\/$/m);
    const wf = read('.github/workflows/release.yml');
    expect(wf).toContain("'v*'");
    expect(wf).toContain('npm run release:check');
    expect(wf).toContain('postshelf-');
  });
});
