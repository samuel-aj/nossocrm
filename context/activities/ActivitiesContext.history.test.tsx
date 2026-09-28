import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ update: vi.fn(), delete: vi.fn(), org: 'orgA' }));
vi.mock('../AuthContext', () => ({ useAuth: () => ({ profile: { id: 'user' }, organizationId: mocks.org }) }));
vi.mock('@/lib/supabase', () => ({ activitiesService: { update: mocks.update, delete: mocks.delete } }));
vi.mock('@/lib/query/hooks/useActivitiesQuery', () => ({ useActivities: () => ({ data: [] }) }));
import { ActivitiesProvider, useActivities } from './ActivitiesContext';
import { queryKeys } from '@/lib/query';
beforeEach(() => { mocks.org = 'orgA'; mocks.update.mockResolvedValue({ error: { message: 'failed' } }); mocks.delete.mockResolvedValue({ error: { message: 'failed' } }); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());
function setup() {
 const client = new QueryClient();
 client.setQueryData(queryKeys.activities.lists(), [{ id: 'note', dealId: 'lead', description: 'before' }]);
 return { client, ...renderHook(() => useActivities(), { wrapper: ({ children }) => <QueryClientProvider client={client}><ActivitiesProvider>{children}</ActivitiesProvider></QueryClientProvider> }) };
}
it.each(['update', 'delete'] as const)('preserves legacy %s behavior and rejects failures in strict mode with rollback', async method => {
 const { result, client, unmount } = setup();
 await act(async () => { if (method === 'update') await result.current.updateActivity('note', { description: 'after' }); else await result.current.deleteActivity('note'); });
 await act(async () => { await expect(method === 'update' ? result.current.updateActivity('note', { description: 'after' }, { throwOnError: true }) : result.current.deleteActivity('note', { throwOnError: true })).rejects.toThrow('failed'); });
 expect(client.getQueryData(queryKeys.activities.lists())).toEqual([{ id: 'note', dealId: 'lead', description: 'before' }]);
 unmount(); client.clear();
});
it('does not restore another organization snapshot after a delayed failure', async () => {
 let finish: (value: unknown) => void;
 mocks.update.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
 const { result, client, rerender, unmount } = setup();
 let saving: Promise<void>;
 await act(async () => { saving = result.current.updateActivity('note', { description: 'after' }); await Promise.resolve(); });
 mocks.org = 'orgB'; rerender();
 client.setQueryData(queryKeys.activities.lists(), [{ id: 'other-org' }]);
 await act(async () => { finish({ error: { message: 'failed' } }); await saving; });
 expect(client.getQueryData(queryKeys.activities.lists())).toEqual([{ id: 'other-org' }]);
 unmount(); client.clear();
});
