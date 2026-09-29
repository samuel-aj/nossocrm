import { describe, expect, it } from 'vitest';
import { EvolutionProvider } from './evolution';

const provider = new EvolutionProvider({ baseUrl: 'https://provider.test', instanceName: 'test', token: 'test-only' });
const key = { id: 'reply-id', remoteJid: '5511999999999@s.whatsapp.net', fromMe: false };

describe('Evolution quote normalization', () => {
  it('reads record-level contextInfo from the provider record shape', () => {
    const parsed = provider.parseWebhook({ event: 'messages.upsert', data: {
      key, message: { conversation: 'reply text', messageContextInfo: { threadId: [] } },
      contextInfo: { stanzaId: 'original-id', quotedMessage: { conversation: 'original text' } },
    } });
    expect(parsed).toMatchObject({ kind: 'message', message: {
      quoted: { providerMessageId: 'original-id', text: 'original text' },
    } });
  });

  it('reads nested context after an unrelated context without a reference', () => {
    const parsed = provider.parseWebhook({ event: 'messages.upsert', data: {
      key, message: { ephemeralMessage: { message: { extendedTextMessage: {
        text: 'reply text', contextInfo: { stanzaId: 'original-id', quotedMessage: { imageMessage: { caption: 'photo' } } },
      } } } },
      contextInfo: { forwardingScore: 2 },
    } });
    expect(parsed).toMatchObject({ kind: 'message', message: {
      forwarded: true, quoted: { providerMessageId: 'original-id', text: 'photo', mediaType: 'image' },
    } });
  });
});
