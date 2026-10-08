import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'static/manifest.json'), 'utf8'));
const png = (p: string) => readFileSync(resolve(process.cwd(), 'static', p));

describe('extension icons', () => {
  it('declares 16/32/48/128 icons and action icons 16/32/48', () => {
    expect(Object.keys(manifest.icons).sort()).toEqual(['128', '16', '32', '48']);
    expect(Object.keys(manifest.action.default_icon).sort()).toEqual(['16', '32', '48']);
  });
  it('every referenced icon file exists under static/brand and is a PNG of the declared size', () => {
    const all = { ...manifest.icons, ...manifest.action.default_icon } as Record<string, string>;
    for (const [size, path] of Object.entries(all)) {
      expect(path.startsWith('brand/'), path).toBe(true);
      expect(existsSync(resolve(process.cwd(), 'static', path)), path).toBe(true);
      const b = png(path);
      expect(b.subarray(1, 4).toString()).toBe('PNG');
      expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([Number(size), Number(size)]);
    }
  });
  it('the popup heading uses the brand icon (an extension page, so no web_accessible_resources needed)', () => {
    expect(readFileSync(resolve(process.cwd(), 'src/popup/index.tsx'), 'utf8')).toContain('brand/icon-32.png');
  });
});
