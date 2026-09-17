import { expect, it } from 'vitest';
import { messageDeleteError, MESSAGE_DELETE_WINDOW_MS } from './messageDeletion';
import { messageEditError } from './messageEditing';
const now = Date.now();
const own = { direction: 'out', sent_by: 'me', status: 'sent', body: 'hi', evolution_message_id: 'key', created_at: new Date(now).toISOString() };
it('allows own sent text and media inside the window, not other authors/providers/states', () => {
  expect(messageDeleteError(own, 'me', 'evolution', now)).toBeNull();
  expect(messageDeleteError({ ...own, media_type: 'image' }, 'me', 'evolution', now)).toBeNull();
  for (const patch of [{ sent_by: 'other' }, { direction: 'in' }, { status: 'pending' }, { evolution_message_id: null }, { deleted_at: own.created_at }]) {
    expect(messageDeleteError({ ...own, ...patch }, 'me', 'evolution', now)).not.toBeNull();
  }
  expect(messageDeleteError(own, 'me', 'meta_cloud', now)).not.toBeNull();
  expect(messageDeleteError(own, 'me', 'evolution', now + MESSAGE_DELETE_WINDOW_MS)).not.toBeNull();
  expect(messageEditError({ ...own, deleted_at: own.created_at }, 'me', 'evolution', now)).not.toBeNull();
});
