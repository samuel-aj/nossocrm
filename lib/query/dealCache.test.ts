import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { Deal, DealView } from '@/types';
import { DEALS_VIEW_KEY, queryKeys } from './queryKeys';
import { isDealSaving, reconcileDeal, saveDeal } from './dealCache';
const org = vi.hoisted(() => ({ id: 'org-a' }));
vi.mock('@/lib/tabOrg', () => ({ readTabOrg: () => org }));

const lead = (id = 'lead'): DealView => ({ id, title: id, status: 'new', updatedAt: '2026-09-28T12:00:00Z', contactId: 'contact' } as DealView);
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(DEALS_VIEW_KEY, [lead(), lead('other')]);
  client.setQueryData(queryKeys.deals.detail('lead'), lead());
  return client;
}
const current = (client: QueryClient) => client.getQueryData<DealView[]>(DEALS_VIEW_KEY)![0];

describe('confirmed lead cache', () => {
  it('accepts the server response even when the browser clock differs, then accepts another user change', async () => {
    const client = setup();
    await saveDeal(client, 'lead', { status: 'qualified' }, async () => ({ data: { status: 'qualified', updatedAt: '2026-09-28T12:00:01.123Z' }, error: null }));
    expect(current(client).updatedAt).toBe('2026-09-28T12:00:01.123Z');
    reconcileDeal(client, { ...lead(), status: 'meeting', updatedAt: '2026-09-28T12:00:02Z' });
    expect(current(client).status).toBe('meeting');
    expect(client.getQueryData<Deal>(queryKeys.deals.detail('lead'))?.status).toBe('meeting');
  });
  it('rolls back a failed save without undoing another lead update', async () => {
    const client = setup();
    const pending = deferred<{ error: Error | null }>();
    const save = saveDeal(client, 'lead', { status: 'qualified' }, () => pending.promise);
    expect(current(client).status).toBe('qualified');
    reconcileDeal(client, { ...lead('other'), status: 'won', updatedAt: '2026-09-28T12:00:01Z' });
    pending.resolve({ error: new Error('network failed') });
    await expect(save).rejects.toThrow('network failed');
    expect(current(client).status).toBe('new');
    expect(client.getQueryData<DealView[]>(DEALS_VIEW_KEY)![1].status).toBe('won');
    expect(isDealSaving(client, 'lead')).toBe(false);
  });
  it('serializes rapid edits and keeps the last edit visible while the first save finishes', async () => {
    const client = setup();
    const first = deferred<{ data: Partial<Deal>; error: null }>();
    const persist = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce({ data: { status: 'meeting', updatedAt: '2026-09-28T12:00:02Z' }, error: null });
    const a = saveDeal(client, 'lead', { status: 'qualified' }, persist);
    const b = saveDeal(client, 'lead', { status: 'meeting' }, persist);
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
    expect(current(client).status).toBe('meeting');
    expect(reconcileDeal(client, lead()).status).toBe('meeting');
    first.resolve({ data: { status: 'qualified', updatedAt: '2026-09-28T12:00:01Z' }, error: null });
    await Promise.all([a, b]);
    expect(persist.mock.calls.map(args => args[1].status)).toEqual(['qualified', 'meeting']);
    expect(current(client).status).toBe('meeting');
  });
  it('restores the first confirmed save when a second edit fails', async () => {
    const client = setup();
    const persist = vi.fn().mockResolvedValueOnce({ data: { status: 'qualified' }, error: null }).mockResolvedValueOnce({ error: new Error('denied') });
    const first = saveDeal(client, 'lead', { status: 'qualified' }, persist);
    const second = saveDeal(client, 'lead', { status: 'meeting' }, persist);
    await first;
    await expect(second).rejects.toThrow('denied');
    expect(current(client).status).toBe('qualified');
  });
  it('ignores an old response that arrives after a newer server event', () => {
    const client = setup();
    reconcileDeal(client, { ...lead(), status: 'meeting', updatedAt: '2026-09-28T13:00:00Z' });
    reconcileDeal(client, lead());
    expect(current(client).status).toBe('meeting');
  });
  it('does not restore data into another organization after a late save response', async () => {
    const client = setup();
    const pending = deferred<{ data: Partial<Deal>; error: null }>();
    const persist = vi.fn(() => pending.promise);
    const save = saveDeal(client, 'lead', { status: 'qualified' }, persist);
    await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce());
    org.id = 'org-b';
    client.clear();
    pending.resolve({ data: { status: 'qualified' }, error: null });
    await save;
    expect(client.getQueryData(DEALS_VIEW_KEY)).toBeUndefined();
    expect(client.getQueryData(queryKeys.deals.detail('lead'))).toBeUndefined();
    org.id = 'org-a';
  });
});
