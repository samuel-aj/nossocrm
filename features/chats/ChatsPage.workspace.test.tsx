import React, { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChatsPage } from './ChatsPage';

const state = vi.hoisted(() => ({ width: 1320, mountCount: 0, leadId: 'lead-one' as string | null, noteLeadId: null as string | null }));
const linkedLead = { id: 'lead-one', title: 'Lead confirmado', contactId: 'linked-contact', boardId: 'board', status: 'stage', ownerId: null, createdAt: '2026-09-01', value: 0 };
vi.mock('@/context/CRMContext', () => ({ useCRM: () => ({
  contacts: [{ id: 'chat-contact', name: 'Contato da lista', phone: '+5569999926070' }, { id: 'linked-contact', name: 'Contato do lead', phone: '+5569999926070' }],
  deals: [linkedLead], boards: [], sidebarCollapsed: false, setSidebarCollapsed: vi.fn(),
}) }));
vi.mock('./useConversationLead', () => ({ useConversationLead: () => ({ isFetching: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/lib/query/hooks', () => ({
  useOrgMembers: () => ({ data: [] }),
  useDeal: (id?: string) => ({ data: id === 'lead-one' ? linkedLead : undefined, isSuccess: !!id, isLoading: false, refetch: vi.fn() }),
  useContact: (id?: string) => ({ data: id === 'linked-contact' ? { id, name: 'Contato do lead', phone: '+5569999926070' } : undefined, isSuccess: !!id }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'user', organization_id: 'org' } }) }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/a11y', () => ({ FocusTrap: ({ children }: { children: React.ReactNode }) => <>{children}</>, useFocusReturn: () => {} }));
vi.mock('@/features/deals/lead/LeadPropertiesPanel', () => ({ LeadPropertiesPanel: ({ deal, contact }: { deal: { id: string }; contact: { id: string } | null }) => <aside aria-label="Propriedades do lead">
  <span>Propriedade {deal.id} {contact?.id}</span><input aria-label="Editor da propriedade" defaultValue="" />
</aside> }));
vi.mock('@/features/deals/lead/useLeadConversation', () => ({ useLeadConversation: ({ deal }: { deal: { id: string } | null }) => {
  state.noteLeadId = deal?.id ?? null;
  return { timeline: { noteComposer: <input aria-label="Nota interna" />, entries: [] }, dialogs: null };
} }));
vi.mock('@/features/whatsapp/DealWhatsAppChat', () => ({ DealWhatsAppChat: ({ timeline }: { timeline: { noteComposer?: React.ReactNode } | null }) => {
  const [text, setText] = useState('');
  React.useEffect(() => { state.mountCount++; }, []);
  return <div><input aria-label="Mensagem" value={text} onChange={e => setText(e.target.value)} />{timeline?.noteComposer}</div>;
} }));

let client: QueryClient;
let resizeCallback: ResizeObserverCallback;
const network = vi.fn(async (url: string) => {
  if (url.includes('/conversations')) return Response.json({ data: [
    { id: 'conversation-one', connection_id: 'one', wa_phone: '+5569999926070', contact_id: 'chat-contact', wa_name: 'Contato da lista', last_message_at: '2026-09-28', last_message_preview: 'Olá', unread_count: 0, label_ids: [], deal_id: state.leadId },
  ], groupsEnabled: false });
  return Response.json({ connected: true, connections: [{ id: 'one', phoneNumber: '+5511111111111', status: 'connected' }], labels: [] });
});
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ChatsPage /></QueryClientProvider>);
}
beforeEach(() => {
  state.width = 1320; state.mountCount = 0; state.leadId = 'lead-one'; state.noteLeadId = null;
  vi.stubGlobal('fetch', network);
  vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { resizeCallback = callback; } observe() {} disconnect() {} });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: state.width, height: 900, top: 0, left: 0, right: state.width, bottom: 900, x: 0, y: 0, toJSON: () => ({}) }));
});
afterEach(() => { cleanup(); client?.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('uses confirmed linked lead for notes and properties while keeping the message and property editors mounted', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: /Contato da lista.*Olá/ }));
  expect(await screen.findByRole('complementary', { name: 'Propriedades do lead' })).toBeInTheDocument();
  expect(screen.getByText('Propriedade lead-one linked-contact')).toBeInTheDocument();
  expect(state.noteLeadId).toBe('lead-one');
  fireEvent.change(screen.getByRole('textbox', { name: 'Mensagem' }), { target: { value: 'rascunho' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Editor da propriedade' }), { target: { value: 'rascunho do campo' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ocultar propriedades do lead' }));
  fireEvent.click(screen.getByRole('button', { name: 'Mostrar propriedades do lead' }));
  expect(screen.getByRole('textbox', { name: 'Mensagem' })).toHaveValue('rascunho');
  expect(screen.getByRole('textbox', { name: 'Editor da propriedade' })).toHaveValue('rascunho do campo');
  expect(state.mountCount).toBe(1);
});

it('starts narrow with details closed and opens an accessible drawer on demand', async () => {
  state.width = 760;
  mount();
  fireEvent.click(await screen.findByRole('button', { name: /Contato da lista.*Olá/ }));
  expect(screen.getByRole('button', { name: 'Mostrar propriedades do lead' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('dialog', { name: 'Propriedades do lead' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Mostrar propriedades do lead' }));
  expect(screen.getByRole('dialog', { name: 'Propriedades do lead' })).toHaveAttribute('aria-modal', 'true');
  expect(screen.getByRole('textbox', { name: 'Nota interna' })).toBeInTheDocument();
  expect(state.mountCount).toBe(1);
});

it('does not show stale properties or a note composer for a conversation without a linked lead', async () => {
  state.leadId = null;
  mount();
  fireEvent.click(await screen.findByRole('button', { name: /Contato da lista.*Olá/ }));
  expect(screen.queryByRole('complementary', { name: 'Propriedades do lead' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Mostrar propriedades do lead' })).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'Nota interna' })).not.toBeInTheDocument();
  expect(state.noteLeadId).toBeNull();
});

it('keeps both drafts through a wide to narrow layout change', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: /Contato da lista.*Olá/ }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Mensagem' }), { target: { value: 'mensagem em edição' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Editor da propriedade' }), { target: { value: 'campo em edição' } });
  act(() => { state.width = 760; resizeCallback([], {} as ResizeObserver); });
  expect(screen.getByRole('button', { name: 'Mostrar propriedades do lead' })).toBeInTheDocument();
  act(() => { state.width = 1320; resizeCallback([], {} as ResizeObserver); });
  fireEvent.click(screen.getByRole('button', { name: 'Mostrar propriedades do lead' }));
  expect(screen.getByRole('textbox', { name: 'Mensagem' })).toHaveValue('mensagem em edição');
  expect(screen.getByRole('textbox', { name: 'Editor da propriedade' })).toHaveValue('campo em edição');
  expect(state.mountCount).toBe(1);
});
