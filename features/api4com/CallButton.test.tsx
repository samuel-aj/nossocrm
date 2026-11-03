import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CallButton } from './CallButton';

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ organizationId: 'org-1' }) }));

const ME = { connected: true, name: 'Vendedora', email: null, extension: '1012', domain: null, webhook_ok: true, verified_at: null, last_error: null, token_hint: 'tok-…123' };
const row = (over: Record<string, unknown>) => ({ id: 'row-1', status: 'ringing', result: null, answered_at: null, duration: null, error: null, ...over });

function setup(routes: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const out = routes(String(url), init) as { status?: number; body: unknown };
    return new Response(JSON.stringify(out.body), { status: out.status ?? 200, headers: { 'content-type': 'application/json' } });
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CallButton dealId="00000000-0000-4000-8000-000000000001" contactId={null} phone="+5511987654321" />
    </QueryClientProvider>
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('CallButton', () => {
  it('não aparece para quem não conectou a API4com', async () => {
    setup(() => ({ body: { connected: false } }));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Ligar/ })).toBeNull();
  });

  it('liga, acompanha até o fim e mostra o resultado', async () => {
    let polls = 0;
    setup((url, init) => {
      if (url.endsWith('/me')) return { body: ME };
      if (url.endsWith('/calls') && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toMatchObject({ phone: '+5511987654321', deal_id: '00000000-0000-4000-8000-000000000001' });
        return { body: { call: row({}) } };
      }
      if (url.includes('/calls/row-1')) {
        polls += 1;
        return { body: { call: polls < 2 ? row({ status: 'answered', answered_at: new Date().toISOString() }) : row({ status: 'ended', result: 'answered', duration: 65 }) } };
      }
      return { status: 404, body: {} };
    });
    fireEvent.click(await screen.findByRole('button', { name: /Ligar/ }));
    expect(await screen.findByText(/Chamando o cliente/)).toBeInTheDocument();
    expect(await screen.findByText(/Em ligação/, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Desligar/ })).toBeInTheDocument();
    expect(await screen.findByText(/Atendida · 1 min 5 s/, {}, { timeout: 6000 })).toBeInTheDocument();
  }, 15000);

  it('mostra o motivo quando a API4com recusa (Webphone fechado)', async () => {
    setup((url, init) => {
      if (url.endsWith('/me')) return { body: ME };
      if (init?.method === 'POST') return { status: 424, body: { error: 'O Webphone da API4com não atendeu.' } };
      return { status: 404, body: {} };
    });
    fireEvent.click(await screen.findByRole('button', { name: /Ligar/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Webphone');
  });
});
