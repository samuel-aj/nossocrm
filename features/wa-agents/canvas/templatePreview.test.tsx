import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { templateFitsNumbers, useMessageTemplates } from './templatePreview';

afterEach(() => vi.unstubAllGlobals());

it.each(['api', 'cache'])('preserva o vínculo connectionId vindo de %s', async source => {
  const data = [{ id: 't', name: 'Modelo', type: 'whatsapp_api', connectionId: 'number-a', body: 'Olá' }];
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    data,
  }) }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (source === 'cache') client.setQueryData(['messageTemplates'], { data });
  const { result } = renderHook(useMessageTemplates, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  const template = result.current.data!.data[0];
  expect(templateFitsNumbers(template, ['number-a'])).toBe(true);
  expect(templateFitsNumbers(template, ['number-a', 'number-b'])).toBe(false);
  if (source === 'cache') expect(fetch).not.toHaveBeenCalled();
  client.clear();
});
