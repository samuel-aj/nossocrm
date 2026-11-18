import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppConnectionHistory } from './WhatsAppConnectionHistory';

const line = { organizationId: 'office', userId: 'person', connectionId: 'line' };
function renderHistory() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><WhatsAppConnectionHistory {...line} /></QueryClientProvider>);
}
function incident(id: string, resolved: boolean) {
  return {
    id, openedAt: '2026-11-18T02:10:00Z', resolvedAt: resolved ? '2026-11-18T03:00:00Z' : null,
    resolution: resolved ? 'reconnected' : null, observation: `Observação ${id}`, detectedBy: 'Controle de envio do CRM',
    observedBy: 'Verificação do provedor', observedAt: '2026-11-18T02:11:00Z',
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('histórico por número', () => {
  it('shows the empty result for the requested line', async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ items: [], nextCursor: null }));
    vi.stubGlobal('fetch', request);
    renderHistory();
    expect(await screen.findByText(/Nenhum incidente registrado/)).toBeVisible();
    expect(request).toHaveBeenCalledWith('/api/whatsapp/connection/history?connectionId=line', expect.objectContaining({ credentials: 'include' }));
  });

  it('shows open and recovered incidents, evidence and earlier pages for this line', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(Response.json({ items: [incident('recente', false)], nextCursor: 't+1' }))
      .mockResolvedValueOnce(Response.json({ items: [incident('anterior', true)], nextCursor: null }));
    vi.stubGlobal('fetch', request);
    renderHistory();
    expect(await screen.findByText('Em andamento')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Ver incidentes anteriores' }));
    expect(await screen.findByText('Observação anterior')).toBeVisible();
    expect(screen.getByText('Observação recente')).toBeVisible();
    expect(screen.getByText(/Reconexão/)).toBeVisible();
    expect(request.mock.calls[1][0]).toBe('/api/whatsapp/connection/history?connectionId=line&cursor=t%2B1');
    expect(screen.queryByRole('button', { name: 'Ver incidentes anteriores' })).not.toBeInTheDocument();
  });

  it('separates failure from an empty history and retries without changing the connection', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ items: [], nextCursor: null })));
    renderHistory();
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar');
    expect(screen.queryByText(/Nenhum incidente registrado/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText(/Nenhum incidente registrado/)).toBeVisible();
  });
});
