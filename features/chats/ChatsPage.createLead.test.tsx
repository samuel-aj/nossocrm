import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { ChatsPage } from './ChatsPage';

const mocks = vi.hoisted(() => ({ addDeal: vi.fn(), addToast: vi.fn() }));
const lead = { id: 'new-lead', title: 'João', contactId: 'joao', boardId: 'board', status: 'new', value: 0, createdAt: '2026-10-08' };
vi.mock('@/context/CRMContext', () => ({ useCRM: () => ({
  contacts: [{ id: 'joao', name: 'João', phone: '+556798671148' }],
  deals: [], boards: [{ id: 'board', name: 'Vendas', stages: [{ id: 'new', label: 'Novo' }] }],
  addDeal: mocks.addDeal, sidebarCollapsed: false, setSidebarCollapsed: vi.fn(),
}) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'user', organization_id: 'org' } }) }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: mocks.addToast }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock('./useConversationLead', () => ({ useConversationLead: () => ({ isFetching: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/lib/query/hooks', () => ({
  useOrgMembers: () => ({ data: [] }),
  useDeal: (id?: string) => ({ data: id === 'new-lead' ? lead : undefined, isLoading: false, refetch: vi.fn() }),
  useContact: () => ({ data: undefined, isSuccess: false }),
}));
vi.mock('@/features/deals/lead/useLeadConversation', () => ({ useLeadConversation: () => ({ timeline: {}, dialogs: null }) }));
vi.mock('@/features/deals/lead/LeadPropertiesPanel', () => ({ LeadPropertiesPanel: () => null }));
vi.mock('@/features/deals/lead/DealStageControl', () => ({ DealStageControl: () => null }));
vi.mock('@/features/whatsapp/DealWhatsAppChat', () => ({ DealWhatsAppChat: ({ headerContext }: { headerContext?: React.ReactNode }) => <div>{headerContext}</div> }));

let client: QueryClient;
beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
  HTMLElement.prototype.scrollIntoView = () => {};
});
afterEach(() => { cleanup(); client?.clear(); vi.unstubAllGlobals(); });

it.each(['Indicação', null])('creates and links a lead with source %s without treating the unread counter as a list', async source => {
  mocks.addDeal.mockReset().mockResolvedValue(lead);
  mocks.addToast.mockReset();
  let linked = false;
  const conversation = () => ({ id: 'chat', connection_id: 'connection', wa_phone: '+556798671148', contact_id: 'joao', wa_name: 'João',
    last_message_at: '2026-10-08', last_message_preview: 'Olá', unread_count: 0, label_ids: [], deal_id: linked ? lead.id : null });
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/whatsapp/conversations/chat' && init?.method === 'PATCH') {
      linked = true;
      return Response.json({ conversation: { ...conversation(), deal_link_mode: 'manual' } });
    }
    if (url.startsWith('/api/whatsapp/conversations')) return Response.json({ data: [conversation()], groupsEnabled: false });
    if (url.includes('/connection')) return Response.json({ connected: true, connections: [{ id: 'connection', phoneNumber: '+5569999999999', status: 'connected' }] });
    return Response.json({ labels: [] });
  });
  vi.stubGlobal('fetch', fetcher);
  sessionStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['waConversations', 'unread'], { total: 7 });
  client.setQueryData(['waConversations', 'connection'], { data: [conversation()] });
  render(<QueryClientProvider client={client}><ChatsPage /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button', { name: /João.*Olá/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Criar lead' }));
  expect(screen.getByRole('heading', { name: 'Criar lead' })).toBeInTheDocument();
  if (source) {
    await userEvent.click(screen.getByRole('combobox', { name: 'Origem do lead' }));
    await userEvent.click(screen.getByRole('option', { name: source }));
  }
  fireEvent.click(screen.getAllByRole('button', { name: 'Criar lead' }).at(-1)!);
  await waitFor(() => expect(mocks.addToast).toHaveBeenCalledWith('Lead criado em "Vendas"!', 'success'));
  expect(mocks.addDeal).toHaveBeenCalledWith(expect.objectContaining({ contactId: 'joao', title: 'João', boardId: 'board', status: 'new', leadSource: source }));
  expect(fetcher).toHaveBeenCalledWith('/api/whatsapp/conversations/chat', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ dealId: 'new-lead' }) }));
  expect(mocks.addToast.mock.calls.some(([, variant]) => variant === 'error')).toBe(false);
  expect(screen.queryByRole('heading', { name: 'Criar lead' })).not.toBeInTheDocument();
  expect(client.getQueryData(['waConversations', 'unread'])).toEqual({ total: 7 });
  expect(client.getQueryData<{ data: Array<{ deal_id: string }> }>(['waConversations'])?.data[0].deal_id).toBe('new-lead');
  expect(client.getQueryData<{ data: Array<{ deal_id: string }> }>(['waConversations', 'connection'])?.data[0].deal_id).toBe('new-lead');
});
