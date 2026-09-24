import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { refreshLinkedLabels } from './labelCache';
import { DEALS_VIEW_KEY, queryKeys } from '@/lib/query/queryKeys';
describe('linked label cache refresh', () => {
  it('refreshes canonical lead, raw list/detail and chat caches', async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await refreshLinkedLabels(client);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: DEALS_VIEW_KEY });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.deals.lists() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['waConversations'] });
  });
  it('also informs legacy settings catalog consumers', async () => {
    const callback = vi.fn();
    window.addEventListener('crm:labels-changed', callback);
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await refreshLinkedLabels(client, true);
    expect(callback).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['waLabels'] });
    window.removeEventListener('crm:labels-changed', callback);
  });
});
