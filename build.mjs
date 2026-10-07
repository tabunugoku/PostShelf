import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

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
  minify: false,
  logLevel: 'info',
});

await cp('static', 'dist', { recursive: true });

// Tabler Icons (outline) をローカル同梱 (CDN 禁止)
const tabler = 'node_modules/@tabler/icons-webfont/dist';
await mkdir('dist/icons/fonts', { recursive: true });
await cp(`${tabler}/tabler-icons.min.css`, 'dist/icons/tabler-icons.min.css');
for (const ext of ['woff2', 'woff', 'ttf']) {
  await cp(`${tabler}/fonts/tabler-icons.${ext}`, `dist/icons/fonts/tabler-icons.${ext}`);
}
