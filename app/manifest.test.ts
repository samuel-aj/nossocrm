import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from './manifest';

// Lê o cabeçalho do PNG: tamanho real e tipo de cor (2 = RGB, sem transparência).
function readPng(file: string) {
  const bytes = readFileSync(file);
  return { size: `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, colorType: bytes[25] };
}

describe('manifest', () => {
  const icons = manifest().icons ?? [];
  const pngs = icons.filter((icon) => icon.type === 'image/png');
  const publicFile = (src: string) => path.join(process.cwd(), 'public', src);

  it('lista PNGs de 192 e 512 de uso geral e um PNG maskable', () => {
    const general = pngs.filter((icon) => icon.purpose !== 'maskable');
    expect(general.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(pngs.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  it('só aponta para arquivos que existem em public/', () => {
    for (const icon of icons) {
      expect(existsSync(publicFile(icon.src)), icon.src).toBe(true);
    }
  });

  it('declara para cada PNG o tamanho real do arquivo', () => {
    for (const icon of pngs) {
      expect(readPng(publicFile(icon.src)).size, icon.src).toBe(icon.sizes);
    }
  });

  it('tem o apple-touch-icon do iPhone em 180x180 e sem transparência', () => {
    // O iPhone pinta de preto qualquer transparência do ícone da Tela de Início.
    expect(readPng(path.join(process.cwd(), 'app', 'apple-icon.png'))).toEqual({ size: '180x180', colorType: 2 });
  });
});
