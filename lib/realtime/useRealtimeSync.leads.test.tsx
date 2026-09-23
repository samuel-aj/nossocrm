import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ listeners: new Map<string, (p: unknown) => void>(), getDeal: vi.fn(), getContact: vi.fn(), org: { id: 'org' } as { id: string } | null }));
vi.mock('@/lib/supabase', () => ({ supabase: { channel: () => {
 const channel = { on: (_: string, options: { table: string }, cb: (p: unknown) => void) => { mocks.listeners.set(options.table,cb); return channel; }, subscribe: () => channel };
 return channel;
}, removeChannel: vi.fn() } }));
vi.mock('@/lib/supabase/deals', () => ({ dealsService: { getById: mocks.getDeal } }));
vi.mock('@/lib/supabase/contacts', () => ({ contactsService: { getById: mocks.getContact } }));
vi.mock('@/lib/tabOrg', () => ({ readTabOrg: () => mocks.org }));
import { useRealtimeSyncAll } from './useRealtimeSync';
import { DEALS_VIEW_KEY, queryKeys } from '@/lib/query/queryKeys';

function setup() {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
 client.setQueryData(DEALS_VIEW_KEY, []);
 const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
 const hook = renderHook(() => useRealtimeSyncAll({ debounceMs: 0 }),{wrapper});
 return { client, ...hook };
}
beforeEach(() => { mocks.listeners.clear(); mocks.org={id:'org'}; mocks.getDeal.mockReset(); mocks.getContact.mockReset(); });
describe('live imported leads', () => {
 it('hydrates a new lead with its contact and products without reloading', async () => {
  const {client,unmount}=setup();
  mocks.getDeal.mockResolvedValue({data:{id:'lead',contactId:'contact',updatedAt:'2026-09-23T01:00:00Z',items:[{id:'item',name:'Produto'}],customFields:{pedido:'Formulário'}}});
  mocks.getContact.mockResolvedValue({data:{id:'contact',name:'Lead formulário',phone:'+5511999990000',updatedAt:'2026-09-23T01:00:00Z'}});
  act(()=>mocks.listeners.get('deals')!({eventType:'INSERT',new:{id:'lead',organization_id:'org',contact_id:'contact',updated_at:'2026-09-23T01:00:00Z',custom_fields:{pedido:'Formulário'}}}));
  await waitFor(()=>expect(client.getQueryData(DEALS_VIEW_KEY)).toEqual([expect.objectContaining({customFields:{pedido:'Formulário'},contactName:'Lead formulário',items:[{id:'item',name:'Produto'}]})]));
  expect(client.getQueryData(queryKeys.contacts.lists())).toEqual([expect.objectContaining({name:'Lead formulário'})]);
  expect(mocks.listeners.has('contacts')).toBe(true);
  unmount();
 });
 it('updates the canonical cache consumed by the board and open lead, preserving products', () => {
  const {client,unmount}=setup();
  client.setQueryData(DEALS_VIEW_KEY,[{id:'lead',items:[{id:'p'}],customFields:{old:'value'},updatedAt:'2026-09-23T01:00:00Z'}]);
  act(()=>mocks.listeners.get('deals')!({eventType:'UPDATE',new:{id:'lead',organization_id:'org',custom_fields:{answer:'Typebot'},owner_id:'owner',updated_at:'2026-09-23T01:00:02Z'}}));
  expect(client.getQueryData(DEALS_VIEW_KEY)).toEqual([expect.objectContaining({customFields:{answer:'Typebot'},ownerId:'owner',items:[{id:'p'}]})]);
  unmount();
 });
 it('does not insert events from another organization', () => {
  const {client,unmount}=setup();
  act(()=>mocks.listeners.get('deals')!({eventType:'INSERT',new:{id:'outside',organization_id:'other'}}));
  expect(client.getQueryData(DEALS_VIEW_KEY)).toEqual([]);
  expect(mocks.getDeal).not.toHaveBeenCalled();unmount();
 });
});
