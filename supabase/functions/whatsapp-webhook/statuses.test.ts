import { describe, expect, it, vi } from 'vitest';
import { applyDeliveryStatus, parseDeliveryStatus, UNKNOWN_DELIVERY_ERROR } from './statuses';

function database(status = 'sent', error: string | null = null, fail = false) {
  const message = { id: 'row', status, error };
  const filters: Array<[string, unknown]> = [];
  let pending: Partial<typeof message> = {};
  const q = {
    select: () => q,
    eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
    maybeSingle: async () => ({ data: message, error: null }),
    update: (value: typeof pending) => { pending = value; return q; },
    in: async (_key: string, statuses: string[]) => {
      if (!fail && statuses.includes(message.status)) Object.assign(message, pending);
      return { error: fail ? { message: 'database unavailable' } : null };
    },
  };
  return { db: { from: vi.fn(() => q) }, message, filters };
}

describe('Evolution delivery callbacks', () => {
  it('extracts nested provider errors without storing the full payload', () => {
    expect(parseDeliveryStatus({ key: { id: 'msg' }, update: { status: 0, errors: [{ code: 500, error_data: { details: 'Connection Closed' } }] }, apikey: 'secret' }))
      .toEqual({ id: 'msg', status: 'failed', error: 'Evolution: 500 — Connection Closed' });
  });
  it('explicitly identifies a callback that supplied no cause', () => {
    expect(parseDeliveryStatus({ keyId: 'msg', status: 'ERROR' })?.error).toBe(UNKNOWN_DELIVERY_ERROR);
  });
  it('ignores an unknown status instead of inventing delivery', () => {
    expect(parseDeliveryStatus({ keyId: 'msg', status: 'PENDING' })).toBeNull();
    expect(parseDeliveryStatus({ status: 'READ' })).toBeNull();
  });
  it('persists the reason in the same update as the failed status, scoped to sender and organization', async () => {
    const { db, message, filters } = database();
    await applyDeliveryStatus(db, 'org', 'sender', { keyId: 'msg', status: 'ERROR', error: { message: 'Connection Closed' } });
    expect(message.status).toBe('failed'); expect(message.error).toContain('Connection Closed');
    expect(filters).toContainEqual(['organization_id', 'org']);
    expect(filters).toContainEqual(['wa_conversations.connection_id', 'sender']);
  });
  it('late confirmed delivery recovers a failed bubble and clears the stale error', async () => {
    const { db, message } = database('failed', 'old error');
    await applyDeliveryStatus(db, 'org', 'sender', { keyId: 'msg', status: 'DELIVERY_ACK' });
    expect(message.status).toBe('delivered'); expect(message.error).toBeNull();
  });
  it.each(['delivered', 'read'])('never downgrades %s when an old failure arrives', async status => {
    const { db, message } = database(status);
    await applyDeliveryStatus(db, 'org', 'sender', { keyId: 'msg', status: 'ERROR' });
    expect(message.status).toBe(status); expect(message.error).toBeNull();
  });
  it('keeps an existing precise reason when a duplicate callback omits it', async () => {
    const { db, message } = database('failed', 'Connection Closed');
    await applyDeliveryStatus(db, 'org', 'sender', { keyId: 'msg', status: 'ERROR' });
    expect(message.error).toBe('Connection Closed');
  });
  it('surfaces persistence failures so the webhook returns a retryable response', async () => {
    const { db } = database('sent', null, true);
    await expect(applyDeliveryStatus(db, 'org', 'sender', { keyId: 'msg', status: 'ERROR' })).rejects.toThrow('registrar');
  });
});
