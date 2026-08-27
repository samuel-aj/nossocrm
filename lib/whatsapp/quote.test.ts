import { describe, expect, it } from 'vitest';
import { clampQuote, outboundKindFromMediaType, quotedPreviewText, snapshotFromMessage } from './quote';

describe('quote helpers', () => {
  it('monta o retrato a partir da mensagem', () => {
    expect(
      snapshotFromMessage({ body: 'oi', media_type: null, direction: 'in', evolution_message_id: 'ABC' })
    ).toEqual({ provider_id: 'ABC', body: 'oi', media_type: null, direction: 'in' });
    expect(snapshotFromMessage({ body: null, media_type: 'image', direction: 'out' })).toEqual({
      provider_id: null,
      body: null,
      media_type: 'image',
      direction: 'out',
    });
  });

  it('prévia: texto puro, mídia com e sem legenda, contato, vazio', () => {
    expect(quotedPreviewText({ body: 'bom dia', media_type: null })).toBe('bom dia');
    expect(quotedPreviewText({ body: null, media_type: 'image' })).toBe('📷 Foto');
    expect(quotedPreviewText({ body: 'olha isso', media_type: 'video' })).toBe('🎥 Vídeo · olha isso');
    expect(quotedPreviewText({ body: 'Maria\n+5511999999999', media_type: 'contact' })).toBe('👤 Contato: Maria');
    expect(quotedPreviewText({ body: '   ', media_type: null })).toBe('Mensagem');
    expect(quotedPreviewText(null)).toBe('Mensagem');
  });

  it('corta prévias longas e achata quebras de linha', () => {
    expect(clampQuote('a\n\nb   c')).toBe('a b c');
    const long = 'x'.repeat(400);
    expect(clampQuote(long).length).toBe(300);
    expect(clampQuote(long).endsWith('…')).toBe(true);
  });

  it('só mídia com arquivo vira envio de mídia', () => {
    expect(outboundKindFromMediaType('image')).toBe('image');
    expect(outboundKindFromMediaType('sticker')).toBe('sticker');
    expect(outboundKindFromMediaType('contact')).toBeNull();
    expect(outboundKindFromMediaType(null)).toBeNull();
  });
});
