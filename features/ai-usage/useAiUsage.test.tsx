import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { queryKeys } from '@/lib/query/queryKeys';

const request = vi.hoisted(() => vi.fn());
vi.mock('@/features/wa-agents/useWaAgents', () => ({ waAgentsFetch: request }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { organization_id: 'org' } }) }));
import { useGrantUsage } from './useAiUsage';

it('refreshes all usage markers after a successful grant without invoking resume or sending', async () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  request.mockResolvedValue({});
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const view = renderHook(() => useGrantUsage('conversation'), { wrapper });
  const body = { tokens: 1000, reason: 'Responsável autorizou', idempotencyKey: 'grant' };
  await act(() => view.result.current.mutateAsync(body));
  expect(request).toHaveBeenCalledExactlyOnceWith('/api/ai-usage/conversations/conversation/grant', { method: 'POST', body });
  for (const queryKey of [queryKeys.aiUsage.all, ['waAgents'], ['board-automation-state'], ['waConversations']]) {
    expect(invalidate).toHaveBeenCalledWith({ queryKey });
  }
  view.unmount(); client.clear();
});
