import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatsPage } from './ChatsPage';

const m = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/context/CRMContext', () => ({ useCRM: () => ({ contacts: [], deals: [], boards: [], sidebarCollapsed: false, setSidebarCollapsed: vi.fn() }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'user', organization_id: 'org' } }) }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: m.toast }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock('./useConversationLead', () => ({ useConversationLead: () => ({ isFetching: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/lib/query/hooks', () => ({ useOrgMembers: () => ({ data: [] }), useDeal: () => ({}), useContact: () => ({}) }));
vi.mock('@/features/deals/lead/useLeadConversation', () => ({ useLeadConversation: () => ({ timeline: {}, dialogs: null }) }));
vi.mock('@/features/deals/lead/LeadPropertiesPanel', () => ({ LeadPropertiesPanel: () => null }));
vi.mock('@/features/deals/lead/DealStageControl', () => ({ DealStageControl: () => null }));
vi.mock('@/features/whatsapp/DealWhatsAppChat', () => ({ DealWhatsAppChat: () => <div>Chat de demonstração</div> }));
vi.mock('@/components/ui/NativeSelect', () => ({ NativeSelect: (props: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} /> }));

const meta = { id: 'meta', provider: 'meta_cloud', phoneNumber: '+5511999991000', profileName: 'Oficial', status: 'connected' };
const qr = { id: 'qr', provider: 'evolution', phoneNumber: '+5511999992000', profileName: 'Equipe', status: 'connected' };
let connections = [meta, qr];
let client: QueryClient;
let fetcher: ReturnType<typeof vi.fn>;
let createResult: () => Response;
beforeEach(() => {
  connections = [meta, qr];
  m.toast.mockReset();
  sessionStorage.clear();
  createResult = () => Response.json({ error: 'Este número não está habilitado pela Meta para criar grupos pela API oficial.', code: 'GROUPS_NOT_ELIGIBLE' }, { status: 422 });
  fetcher = vi.fn(async (url: string) => {
    if (url === '/api/whatsapp/groups/create') return createResult();
    if (url.includes('/connection')) return Response.json({ connected: true, connections });
    if (url.startsWith('/api/whatsapp/conversations')) return Response.json({ data: [], groupsEnabled: true });
    return Response.json({ labels: [] });
  });
  vi.stubGlobal('fetch', fetcher);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });

async function open() {
  render(<QueryClientProvider client={client}><ChatsPage /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'Novo grupo' }));
  return within(screen.getByRole('dialog', { name: 'Novo grupo' }));
}
const creations = () => fetcher.mock.calls.filter(([url]) => url === '/api/whatsapp/groups/create');

describe('explicit group connection', () => {
  it('requires a choice instead of silently picking Meta when all numbers are shown', async () => {
    const modal = await open();
    expect(modal.getByRole('combobox', { name: 'Número do grupo' })).toHaveValue('');
    expect(modal.getByRole('option', { name: /1000.*API oficial/ })).toBeInTheDocument();
    expect(modal.getByRole('option', { name: /2000.*QR Code/ })).toBeInTheDocument();
    expect(modal.getByRole('button', { name: 'Criar grupo' })).toBeDisabled();
    expect(creations()).toHaveLength(0);
  });

  it('keeps the QR filter and explains creation on the phone without calling Meta', async () => {
    sessionStorage.setItem('wa-chats-connection', 'qr');
    const modal = await open();
    expect(modal.getByRole('combobox', { name: 'Número do grupo' })).toHaveValue('qr');
    expect(modal.getByText(/Crie o grupo no WhatsApp do celular/)).toBeInTheDocument();
    expect(modal.queryByLabelText('Nome do grupo')).not.toBeInTheDocument();
    fireEvent.click(modal.getByRole('button', { name: 'Criar grupo' }));
    expect(creations()).toHaveLength(0);
  });

  it('shows the selected number even when only one official connection exists', async () => {
    connections = [meta];
    const modal = await open();
    expect(modal.getByRole('combobox', { name: 'Número do grupo' })).toHaveValue('meta');
    expect(modal.getByText(/habilitados pela Meta/)).toBeInTheDocument();
  });

  it('does not switch to the sole official number when the filtered QR connection disconnects', async () => {
    connections = [meta, { ...qr, status: 'disconnected' }];
    sessionStorage.setItem('wa-chats-connection', 'qr');
    const modal = await open();
    expect(modal.getByRole('combobox', { name: 'Número do grupo' })).toHaveValue('');
    expect(modal.getByRole('button', { name: 'Criar grupo' })).toBeDisabled();
    expect(creations()).toHaveLength(0);
  });

  it('uses the conversation connection when all numbers are visible', async () => {
    client.setQueryData(['waConversations'], { groupsEnabled: true, data: [{
      id: 'chat-qr', connection_id: 'qr', wa_phone: '+5511999993000', wa_name: 'Pessoa Exemplo',
      contact_id: null, last_message_at: '2026-10-14', last_message_preview: 'Olá', unread_count: 0,
    }] });
    render(<QueryClientProvider client={client}><ChatsPage /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: /Pessoa Exemplo.*Olá/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Novo grupo' }));
    expect(within(screen.getByRole('dialog', { name: 'Novo grupo' })).getByRole('combobox', { name: 'Número do grupo' })).toHaveValue('qr');
    expect(creations()).toHaveLength(0);
  });

  it('uses the chosen official number instead of the first official connection', async () => {
    connections = [meta, { ...meta, id: 'second-meta', phoneNumber: '+5511999994000' }];
    sessionStorage.setItem('wa-chats-connection', 'second-meta');
    const modal = await open();
    expect(modal.getByRole('combobox', { name: 'Número do grupo' })).toHaveValue('second-meta');
    fireEvent.change(modal.getByLabelText('Nome do grupo'), { target: { value: 'Demonstração' } });
    fireEvent.click(modal.getByRole('button', { name: 'Criar grupo' }));
    await modal.findByRole('alert');
    expect(JSON.parse(creations()[0][1].body).connectionId).toBe('second-meta');
  });

  it('keeps the form and translates eligibility refusal inline, preventing an immediate repeat', async () => {
    connections = [meta];
    const modal = await open();
    fireEvent.change(modal.getByLabelText('Nome do grupo'), { target: { value: 'Grupo de demonstração' } });
    fireEvent.click(modal.getByRole('button', { name: 'Criar grupo' }));
    expect(await modal.findByRole('alert')).toHaveTextContent('não está habilitado');
    expect(modal.getByLabelText('Nome do grupo')).toHaveValue('Grupo de demonstração');
    expect(modal.getByRole('button', { name: 'Criar grupo' })).toBeDisabled();
    fireEvent.keyDown(modal.getByLabelText('Nome do grupo'), { key: 'Enter' });
    expect(creations()).toHaveLength(1);
    expect(JSON.parse(creations()[0][1].body)).toMatchObject({ connectionId: 'meta', subject: 'Grupo de demonstração' });
  });

  it('clears the previous error when selecting another connection', async () => {
    const modal = await open();
    fireEvent.change(modal.getByRole('combobox', { name: 'Número do grupo' }), { target: { value: 'meta' } });
    fireEvent.change(modal.getByLabelText('Nome do grupo'), { target: { value: 'Demonstração' } });
    fireEvent.click(modal.getByRole('button', { name: 'Criar grupo' }));
    await modal.findByRole('alert');
    fireEvent.change(modal.getByRole('combobox', { name: 'Número do grupo' }), { target: { value: 'qr' } });
    expect(modal.queryByRole('alert')).not.toBeInTheDocument();
    expect(modal.getByText(/Crie o grupo no WhatsApp do celular/)).toBeInTheDocument();
  });

  it('does not mistake an upstream outage for an eligibility refusal', async () => {
    connections = [meta];
    createResult = () => Response.json({ error: 'Falha de rede' }, { status: 502 });
    const modal = await open();
    fireEvent.change(modal.getByLabelText('Nome do grupo'), { target: { value: 'Demonstração' } });
    fireEvent.click(modal.getByRole('button', { name: 'Criar grupo' }));
    expect(await modal.findByRole('alert')).toHaveTextContent('Falha de rede');
    expect(modal.getByRole('button', { name: 'Criar grupo' })).toBeEnabled();
  });

  it('preserves successful creation and opens the returned conversation', async () => {
    connections = [meta];
    createResult = () => Response.json({ conversationId: 'new-group', inviteLink: null });
    const modal = await open();
    fireEvent.change(modal.getByLabelText('Nome do grupo'), { target: { value: 'Demonstração' } });
    fireEvent.click(modal.getByRole('button', { name: 'Criar grupo' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Novo grupo' })).not.toBeInTheDocument());
    expect(m.toast).toHaveBeenCalledWith(expect.stringContaining('Grupo criado'), 'success');
    expect(creations()).toHaveLength(1);
  });
});
