import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const CSS_TEXT_PREFIX = '\0css-text:';

export default defineConfig({
  // build.mjs の loader: { '.css': 'text' } と同じく、CSS を文字列として取り込む。
  // vitest は .css で終わる ID の中身を空にするので、拡張子を付け替えた ID にして、実際のファイルを読む
  plugins: [
    {
      name: 'css-as-text',
      enforce: 'pre',
      resolveId(source, importer) {
        if (source.endsWith('.css') && !source.startsWith(CSS_TEXT_PREFIX) && importer) return CSS_TEXT_PREFIX + resolve(dirname(importer), source).replace(/\.css$/, '.css-text');
      },
      load(id) {
        if (id.startsWith(CSS_TEXT_PREFIX)) {
          return `export default ${JSON.stringify(readFileSync(id.slice(CSS_TEXT_PREFIX.length).replace(/\.css-text$/, '.css'), 'utf8'))};`;
        }
      },
    },
  ],
  test: { environment: 'jsdom', globals: true, include: ['test/**/*.test.{ts,tsx}'] },
});
