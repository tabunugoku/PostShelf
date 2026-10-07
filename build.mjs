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
