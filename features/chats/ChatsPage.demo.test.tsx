import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ChatsPage } from './ChatsPage';

vi.mock('@/context/CRMContext', () => ({ useCRM: () => ({ contacts: [{ id: 'contact-one', name: 'Contato existente', phone: '+5569911111111' }], deals: [], boards: [] }) }));
vi.mock('@/lib/query/hooks', () => ({ useOrgMembers: () => ({ data: [] }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'user', organization_id: 'org' } }) }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock('@/features/whatsapp/DealWhatsAppChat', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/whatsapp/DealWhatsAppChat')>(),
  DealWhatsAppChat: () => <div>Conversa existente aberta</div>,
}));

const clients: QueryClient[] = [];
const network = vi.fn(async () => Response.json({ connected: true, connections: [], data: [], labels: [] }));
function mount(stagingDemo = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}><ChatsPage stagingDemo={stagingDemo} /></QueryClientProvider>);
}
beforeEach(() => { vi.stubGlobal('fetch', network); network.mockClear(); Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { clients.forEach(c => c.clear()); clients.length = 0; vi.unstubAllGlobals(); });

describe('inline staging QR demo', () => {
  it('opens the demo by default with editable text, and returns to it from an existing chat', async () => {
    mount(true);
    expect(screen.getByRole('textbox', { name: 'Mensagem de teste' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir número de teste QR' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Opções da mensagem' }));
    expect(screen.getByRole('menuitem', { name: 'Editar' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(await screen.findByRole('button', { name: /Contato existente/ }));
    expect(screen.getByText('Conversa existente aberta')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Mensagem de teste' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir número de teste QR' }));
    expect(screen.getByRole('textbox', { name: 'Mensagem de teste' })).toBeInTheDocument();
    await waitFor(() => expect(network).toHaveBeenCalled());
    expect(network.mock.calls.every(call => !/\/(send|edit|upload)/.test(String((call as unknown[])[0])))).toBe(true);
  });
  it('does not show or auto-open the simulation when staging is disabled', () => {
    mount();
    expect(screen.queryByRole('button', { name: 'Abrir número de teste QR' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Mensagem de teste' })).not.toBeInTheDocument();
  });
});
