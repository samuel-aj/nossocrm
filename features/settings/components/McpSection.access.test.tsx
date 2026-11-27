// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { McpSection } from './McpSection';

vi.mock('@/context/ToastContext', () => ({ useOptionalToast: () => ({ addToast: vi.fn() }) }));
vi.mock('@/components/ui/NativeSelect', () => ({
  NativeSelect: (props: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} />,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each(['squad_read', 'squad_prompt'])('cria no escopo %s e testa a própria chave só com initialize e tools/list', async mode => {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (url === '/api/api-keys') {
      expect(body.accessMode).toBe(mode);
      return Response.json({ data: { token: 'teste-local', key_prefix: 'prefixo' } });
    }
    expect(url).toBe('/api/mcp');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer teste-local');
    if (body.method === 'initialize') return Response.json({ result: { protocolVersion: '2025-11-25' } });
    if (body.method === 'tools/list') return Response.json({ result: { tools: [{ name: 'crm.ai_agents.list' }] } });
    throw new Error('Operação inesperada');
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<McpSection />);
  fireEvent.change(screen.getByLabelText('Acesso da nova chave'), { target: { value: mode } });
  fireEvent.click(screen.getByRole('button', { name: 'Conectar' }));
  await waitFor(() => expect(screen.getByText('Conectado')).toBeTruthy());
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('avisa quando a chave é reconhecida mas o catálogo está vazio', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe('/api/mcp');
    const { method } = JSON.parse(String(init.body));
    return Response.json({ result: method === 'initialize' ? { protocolVersion: '2025-11-25' } : { tools: [] } });
  }));
  render(<McpSection />);
  fireEvent.click(screen.getByRole('button', { name: 'Já tenho uma API key' }));
  fireEvent.change(screen.getByPlaceholderText('Cole aqui sua API key'), { target: { value: 'teste-local' } });
  fireEvent.click(screen.getByRole('button', { name: 'Testar' }));
  expect(await screen.findByText('Nenhuma ferramenta disponível para esta chave')).toBeTruthy();
  expect(screen.queryByText('Pronto.')).toBeNull();
});
