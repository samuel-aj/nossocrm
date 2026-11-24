import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from './manifest';

describe('manifest', () => {
  const icons = manifest().icons ?? [];

  it('lista PNGs de 192 e 512 e um PNG maskable', () => {
    const pngs = icons.filter((icon) => icon.type === 'image/png');
    expect(pngs.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(pngs.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  it('só aponta para arquivos que existem em public/', () => {
    for (const icon of icons) {
      expect(existsSync(path.join(process.cwd(), 'public', icon.src)), icon.src).toBe(true);
    }
  });

  it('tem o apple-touch-icon do iPhone em app/apple-icon.png', () => {
    expect(existsSync(path.join(process.cwd(), 'app', 'apple-icon.png'))).toBe(true);
  });
});
