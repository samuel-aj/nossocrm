import React from 'react';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { ChatsPage } from './ChatsPage';
const fixtures = vi.hoisted(() => ({
  phone: '+5569999926070', search: '',
  rows: [
    { id: 'old', connection_id: 'one', wa_phone: '+5569999926070', contact_id: 'maks', wa_name: 'Maks', last_message_at: '2026-09-23', last_message_preview: 'Antiga', unread_count: 2, label_ids: [], deal_id: null },
    { id: 'new', connection_id: 'two', wa_phone: '+5569999926070', contact_id: 'maks', wa_name: 'Maks', last_message_at: '2026-09-24', last_message_preview: 'Mais recente', unread_count: 3, label_ids: [], deal_id: null },
  ],
}));
vi.mock('@/context/CRMContext', () => ({ useCRM: () => ({ contacts: [{ id: 'maks', name: 'Maks', phone: fixtures.phone }], deals: [], boards: [] }) }));
vi.mock('@/lib/query/hooks', () => ({ useOrgMembers: () => ({ data: [] }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'user', organization_id: 'org' } }) }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams(fixtures.search) }));
vi.mock('@/features/whatsapp/DealWhatsAppChat', () => ({ DealWhatsAppChat: (props: { connectionId: string | null; initialSenderId?: string; contextConnectionId?: string; onSenderChange: (id: string) => void }) => <div data-testid="chat" data-connection={props.connectionId || 'all'} data-sender={props.initialSenderId} data-context={props.contextConnectionId}><button onClick={() => props.onSenderChange('one')}>Trocar remetente</button></div> }));
let client: QueryClient;
const network = vi.fn(async (url: string) => {
  if (url.includes('/connection') && !url.includes('/conversations')) return Response.json({ connected: true, connections: [{ id: 'one', phoneNumber: '+5511111111111', status: 'connected' }, { id: 'two', phoneNumber: '+5522222222222', status: 'connected' }] });
  if (url.includes('/conversations')) return Response.json({ data: url.includes('connectionId=one') ? fixtures.rows.slice(0, 1) : fixtures.rows, groupsEnabled: true });
  return Response.json({ labels: [] });
});
function mount() { client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); render(<QueryClientProvider client={client}><ChatsPage /></QueryClientProvider>); }
beforeEach(() => { fixtures.search = ''; sessionStorage.clear(); vi.stubGlobal('fetch', network); network.mockClear(); });
afterEach(() => { cleanup(); client?.clear(); vi.unstubAllGlobals(); });

it('shows one row, the latest preview, combined unread count and both sending numbers', async () => {
  mount();
  const row = await screen.findByRole('button', { name: /Maks.*2 números.*Mais recente.*5/ });
  expect(screen.getAllByRole('button', { name: /Maks/ })).toHaveLength(1);
  fireEvent.click(row);
  expect(screen.getByTestId('chat')).toHaveAttribute('data-connection', 'all');
  expect(screen.getByTestId('chat')).toHaveAttribute('data-sender', 'two');
  fireEvent.click(screen.getByRole('button', { name: 'Trocar remetente' }));
  expect(screen.getByTestId('chat')).toHaveAttribute('data-context', 'one');
});
it('keeps an explicit number filter pinned to that number', async () => {
  sessionStorage.setItem('wa-chats-connection', 'one'); mount();
  await waitFor(() => expect(network).toHaveBeenCalledWith('/api/whatsapp/conversations?connectionId=one', expect.anything()));
  fireEvent.click(await screen.findByRole('button', { name: /Maks.*Antiga/ }));
  expect(screen.getByTestId('chat')).toHaveAttribute('data-connection', 'one');
});
it('opens a deep link to an older conversation in the same unified row with its sender selected', async () => {
  fixtures.search = 'conversation=old'; mount();
  expect(await screen.findByTestId('chat')).toHaveAttribute('data-connection', 'all');
  expect(screen.getByTestId('chat')).toHaveAttribute('data-sender', 'one');
});
it('marks the complete unified conversation as read using the phone, never the group-only endpoint', async () => {
  mount(); await screen.findByRole('button', { name: /Maks.*Mais recente/ });
  fireEvent.click(screen.getByRole('button', { name: 'Opções da conversa' }));
  fireEvent.click(screen.getByRole('button', { name: 'Marcar como lida' }));
  await waitFor(() => expect(network).toHaveBeenCalledWith('/api/whatsapp/messages?phone=%2B5569999926070', expect.anything()));
});
