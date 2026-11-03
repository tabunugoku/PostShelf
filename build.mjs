import { build } from 'esbuild';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { cssFontUrls } from './scripts/checks.mjs';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });

await build({
  entryPoints: {
    content: 'src/content/index.ts',
    background: 'src/background/index.ts',
    manager: 'src/manager/index.tsx',
    popup: 'src/popup/index.tsx',
  },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome110',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  // content script は、確認ダイアログの CSS を文字列で読み、閉じた Shadow DOM の中に入れる
  loader: { '.css': 'text' },
  minify: false,
  logLevel: 'info',
});

await cp('static', 'dist', { recursive: true });
await cp('THIRD_PARTY_NOTICES.md', 'dist/THIRD_PARTY_NOTICES.md');

// Tabler Icons (outline) をローカル同梱 (CDN 禁止)
const tabler = 'node_modules/@tabler/icons-webfont/dist';
await mkdir('dist/icons/fonts', { recursive: true });
await cp(`${tabler}/tabler-icons.min.css`, 'dist/icons/tabler-icons.min.css');
// CSS が実際に読むフォントだけを入れる (3.50 から種類ごとの woff2 に分かれ、名前も数も版で変わる)
const tablerCss = await readFile(`${tabler}/tabler-icons.min.css`, 'utf8');
for (const font of cssFontUrls(tablerCss)) {
  await cp(`${tabler}/${font}`, `dist/icons/${font}`);
}
