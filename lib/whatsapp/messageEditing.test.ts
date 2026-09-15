import { describe, expect, it } from 'vitest';
import { messageEditError, MESSAGE_EDIT_WINDOW_MS } from './messageEditing';
const now = Date.parse('2026-09-15T18:00:00Z');
const message = { direction: 'out', sent_by: 'me', status: 'sent', body: 'Olá', media_type: null,
  evolution_message_id: 'provider-id', created_at: new Date(now - 1000).toISOString() };
describe('message editing eligibility', () => {
  it('allows own confirmed text but not another sender, inbound, media or pending messages', () => {
    expect(messageEditError(message, 'me', 'evolution', now)).toBeNull();
    for (const patch of [{ sent_by: 'other' }, { direction: 'in' }, { media_type: 'image' }, { status: 'queued' }, { status: 'failed' }, { evolution_message_id: null }]) {
      expect(messageEditError({ ...message, ...patch }, 'me', 'evolution', now)).not.toBeNull();
    }
  });
  it('does not reset the editing deadline and rejects unsupported providers', () => {
    expect(messageEditError({ ...message, created_at: new Date(now - MESSAGE_EDIT_WINDOW_MS).toISOString() }, 'me', 'evolution', now)).toContain('15 minutos');
    expect(messageEditError({ ...message, created_at: 'invalid' }, 'me', 'evolution', now)).not.toBeNull();
    for (const provider of ['meta_cloud', 'evolution_business']) expect(messageEditError(message, 'me', provider, now)).not.toBeNull();
  });
});
