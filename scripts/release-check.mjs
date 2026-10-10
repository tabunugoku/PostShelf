// npm run release:check — typecheck / test / build / package と、リリース前の機械的な確認
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import {
  LOCALES, checkKeyId, checkLocales, checkManifestFilesInZip, checkNoRemoteCode, checkPermissions, checkVersion, listZip, readJson,
} from './checks.mjs';

const run = (cmd) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
};
for (const cmd of ['npm run typecheck', 'npm test', 'npm run build', 'npm run package']) run(cmd);

const pkg = readJson('package.json');
const manifest = readJson('static/manifest.json');
const distManifest = readJson('dist/manifest.json');
const locales = Object.fromEntries(LOCALES.map((l) => [l, readJson(`static/_locales/${l}/messages.json`)]));
const zipPath = `release/postshelf-${pkg.version}.zip`;

const notesPath = `docs/releases/v${pkg.version}.md`;
const notes = existsSync(notesPath) ? readFileSync(notesPath, 'utf8') : '';
const notesErrors = [];
if (!notes) notesErrors.push(`${notesPath} がありません`);
else for (const h of ['## 追加', '## 修正']) if (!notes.includes(h)) notesErrors.push(`${notesPath} に「${h}」の節がありません`);

const site = readFileSync('site/index.html', 'utf8');
const siteErrors = [];
if (!site.includes(`v${pkg.version} ·`)) siteErrors.push(`site/index.html の版の表示が v${pkg.version} ではありません`);
if (!site.includes(`postshelf-${pkg.version}.zip`)) siteErrors.push(`site/index.html の zip の名前が postshelf-${pkg.version}.zip ではありません`);

const results = [
  ['紹介サイト (site/index.html) の版と zip の名前が現在の version と同じ', siteErrors],
  ['リリースノート (docs/releases/v<version>.md) に「追加」と「修正」の節がある', notesErrors],
  ['version が package.json と一致', checkVersion(manifest, pkg)],
  ['必須の permissions / host_permissions が現在の一覧と同じ', [...checkPermissions(manifest), ...checkPermissions(distManifest)]],
  ['8 言語の messages.json のキーとプレースホルダーを確認（v40 の 2 キーは英語にフォールバック可）', checkLocales(locales)],
  ['dist に外部スクリプト URL / eval / new Function が無い', checkNoRemoteCode('dist')],
  ['manifest が指すファイルがすべて zip に入っている', checkManifestFilesInZip(manifest, listZip(readFileSync(zipPath)))],
  ['key から求めた拡張機能 ID が docs/INSTALL.md と同じ', checkKeyId(manifest, readFileSync('docs/INSTALL.md', 'utf8'))],
];
let failed = false;
console.log('');
for (const [label, errors] of results) {
  console.log(`${errors.length ? 'NG' : 'OK'}  ${label}`);
  for (const e of errors) console.log(`      - ${e}`);
  if (errors.length) failed = true;
}
if (failed) {
  console.error('\nrelease:check 失敗');
  process.exit(1);
}
console.log(`\nrelease:check OK (${zipPath})`);
