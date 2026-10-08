import { expect, it } from 'vitest';
import { traduzErroWhatsApp } from './metaErrorsPtBr';

it('keeps the saved Evolution reason visible instead of replacing it with a generic error', () => {
  expect(traduzErroWhatsApp('Evolution: Connection Closed').explicacao).toContain('Connection Closed');
});
it('distinguishes a missing provider reason from a known Meta window rejection', () => {
  expect(traduzErroWhatsApp('Evolution: falha de entrega informada pelo WhatsApp, sem motivo detalhado no retorno.').explicacao).toContain('sem motivo detalhado');
  const meta = traduzErroWhatsApp('131047 — Re-engagement message');
  expect(meta.codigo).toBe('131047'); expect(meta.explicacao).toContain('modelo aprovado');
});
