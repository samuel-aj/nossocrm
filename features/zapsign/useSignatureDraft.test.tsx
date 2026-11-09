import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { useSignatureDraft } from './useSignatureDraft';

afterEach(() => vi.unstubAllGlobals());

it('conserva os dados conferidos enquanto a sugestão automática da ficha está em andamento', async () => {
  const mapping = { NOME: 'contato.nome', TELEFONE: 'contato.telefone', EMAIL: 'contato.email' };
  const contact = { name: 'Perfil4798', phone: '+551188887777', email: 'sem@email.com' };
  let finishFill!: (res: Response) => void;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/ai-fill')) return new Promise<Response>(resolve => { finishFill = resolve; });
    if (url.includes('/send?')) return Response.json({
      rule: { template_token: 'modelo', variables: mapping, signer: { send: 'link' } },
      contact, connected: true, whatsapp: { ok: true }, sources: [],
      preview: { 'contato.nome': contact.name, 'contato.telefone': contact.phone, 'contato.email': contact.email },
    });
    if (url.includes('variables=1')) return Response.json({ variables: Object.keys(mapping), suggestions: mapping });
    if (url.endsWith('/templates')) return Response.json({ templates: [{ token: 'modelo', name: 'Contrato' }] });
    throw new Error('Requisição não simulada');
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = renderHook(() => useSignatureDraft({ dealId: 'lead' }), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  await waitFor(() => expect(finishFill).toBeTypeOf('function'));
  act(() => result.current.editIdentity('name', 'Felipe '));
  expect(result.current.identity.name).toBe('Felipe ');
  act(() => {
    result.current.editIdentity('name', 'Felipe da Silva');
    result.current.editIdentity('phone', '(11) 98888-7777');
    result.current.editIdentity('email', '');
    finishFill(Response.json({ fields: [
      { name: 'NOME', value: contact.name, changed: true },
      { name: 'TELEFONE', value: contact.phone, changed: true },
      { name: 'EMAIL', value: 'antigo@example.org', changed: true },
    ] }));
  });
  await waitFor(() => expect(result.current.ai.status).toBe('done'));
  expect(result.current.ready).toBe(true);
  expect(result.current.payload()).toMatchObject({
    confirmed_signer: { name: 'Felipe da Silva', phone: '+5511988887777', email: '' },
    overrides: { NOME: 'Felipe da Silva', TELEFONE: '(11) 98888-7777', EMAIL: '' },
  });
});
