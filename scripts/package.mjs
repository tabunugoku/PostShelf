// dist/ を検証してから release/postshelf-<version>.zip を作る。zip の直下に manifest.json が来る
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeZip } from './lib.mjs';
import { checkManifestFilesInZip, distNames, readJson } from './checks.mjs';

const dist = 'dist';
let manifest;
try {
  manifest = readJson(join(dist, 'manifest.json'));
} catch {
  console.error('dist/manifest.json がありません。先に npm run build を実行してください');
  process.exit(1);
}
// ソースマップ・TypeScript・テストなどは、そもそも dist に出さない。出ていたら止める
const names = distNames(dist).filter((n) => !/\.(map|ts|tsx)$/.test(n) || (console.error(`dist に入れてはいけないファイル: ${n}`), process.exit(1)));
const errors = checkManifestFilesInZip(manifest, names);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
const zip = await makeZip(names.map((name) => ({ name, data: readFileSync(join(dist, name)) })));
mkdirSync('release', { recursive: true });
const out = `release/postshelf-${manifest.version}.zip`;
writeFileSync(out, zip);
console.log(`${out} (${names.length} files, ${(zip.length / 1024).toFixed(0)} KB)`);
