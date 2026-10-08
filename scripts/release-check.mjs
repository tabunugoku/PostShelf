// npm run release:check — typecheck / test / build / package と、リリース前の機械的な確認
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

const results = [
  ['version が package.json と一致', checkVersion(manifest, pkg)],
  ['必須の permissions / host_permissions が現在の一覧と同じ', [...checkPermissions(manifest), ...checkPermissions(distManifest)]],
  ['8 言語の messages.json のキーとプレースホルダーが一致', checkLocales(locales)],
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
