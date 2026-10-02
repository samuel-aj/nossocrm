import React, { useState } from 'react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupLinksSettings } from './GroupLinksSettings';
import { GroupRelationsPanel } from './GroupRelationsPanel';
import { RelatedGroups } from './RelatedGroups';
import { GroupLinksVariableField } from './GroupLinksVariableField';
import { groupLinksKeys } from './useGroupLinks';
import { STAGE_WEBHOOK_VARIABLE_GROUPS } from '@/features/boards/automations/stageAutomationModel';
import { BlockPanel } from '@/features/wa-agents/canvas/BlockPanel';
import { WebhooksEditor } from '@/features/wa-agents/WebhooksEditor';
import type { BlockOfType } from '@/features/wa-agents/canvas/types';
import type { AgentAiVar, AgentWebhook } from '@/lib/wa-agents/types';
import { WEBHOOK_VARIABLE_GROUPS } from '@/lib/wa-agents/catalog';

const auth = vi.hoisted(() => ({ organizationId: 'org-1', profile: { role: 'admin' } }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }));
const contacts = [{ id: 'contact-1', name: 'Maria Silva' }, { id: 'contact-2', name: 'João Costa' }];
const deals = [{ id: 'deal-1', name: 'Comercial Aurora' }];
const groups = [
  { id: 'group-1', name: 'Aurora · Reunião', conversationId: 'conversation-1', externalId: '120363012345678901@g.us', provider: 'evolution', isPrimary: false },
  { id: 'group-2', name: 'Aurora · Clientes', conversationId: 'conversation-2', externalId: '120363012345678902@g.us', provider: 'evolution', isPrimary: false },
];
let enabled: boolean;
let fail: string;
let primary: string | null;
let contactLinks: string[];
let dealLinks: string[];
let client: QueryClient;
let failures: Set<string>;
function setup(children: React.ReactNode) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}
beforeEach(() => {
  enabled = false; fail = ''; primary = null; contactLinks = []; dealLinks = []; failures = new Set(); auth.profile.role = 'admin'; auth.organizationId = 'org-1';
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    const method = init?.method ?? 'GET';
    if (fail === 'settings' && url.pathname.endsWith('settings/group-links')) return Response.json({ error: 'Configuração indisponível.' }, { status: 500 });
    if (fail === 'relations' && url.pathname.endsWith('whatsapp/group-links') && method === 'GET') return Response.json({ error: 'Vínculos indisponíveis.' }, { status: 500 });
    if (fail === 'settings-write' && url.pathname === '/api/settings/group-links' && method === 'PATCH') return Response.json({ error: 'Não foi possível salvar a configuração.' }, { status: 500 });
    if (url.pathname === '/api/settings/group-links') {
      if (method === 'PATCH') enabled = JSON.parse(String(init?.body)).enabled;
      return Response.json({ enabled });
    }
    if (url.pathname.endsWith('/options')) {
      const items = url.searchParams.get('type') === 'contact' ? contacts : deals;
      return Response.json({ items: enabled ? items.filter(item => item.name.toLowerCase().includes((url.searchParams.get('q') ?? '').toLowerCase())) : [] });
    }
    if (method === 'POST') {
      const data = JSON.parse(String(init?.body));
      if (failures.has(data.entityId)) return Response.json({ error: 'Não foi possível salvar este vínculo.' }, { status: 403 });
      if (data.entityType === 'contact') contactLinks = data.action === 'link' ? [...new Set([...contactLinks, data.entityId])] : contactLinks.filter(id => id !== data.entityId);
      else {
        const group = groups.find(g => g.conversationId === data.conversationId)!;
        if (data.action === 'set_primary') primary = group.id;
        if (data.action === 'link') { if (!dealLinks.length) primary = group.id; dealLinks = [...new Set([...dealLinks, group.id])]; }
        if (data.action === 'unlink') { dealLinks = dealLinks.filter(id => id !== group.id); if (primary === group.id) primary = null; }
      }
      return Response.json({ ok: true });
    }
    const isConversation = url.searchParams.has('conversationId');
    const visibleGroups = enabled && !isConversation ? groups.filter(g => dealLinks.includes(g.id)).map(g => ({ ...g, isPrimary: primary === g.id })) : [];
    return Response.json({ enabled, contacts: enabled && isConversation ? contacts.filter(c => contactLinks.includes(c.id)) : [], deals: enabled && isConversation && dealLinks.includes(groups.find(g => g.conversationId === url.searchParams.get('conversationId'))?.id ?? '') ? deals : [], groups: visibleGroups, whatsappGroupId: visibleGroups.find(g => g.isPrimary)?.externalId ?? null });
  }));
});

describe('group links UI', () => {
  it('hides relations and ID while unresolved, off, or setting lookup fails', async () => {
    fail = 'settings';
    const view = setup(<><GroupRelationsPanel conversationId="conversation-1" /><RelatedGroups entityType="deal" entityId="deal-1" /></>);
    expect(screen.queryByText('Grupos relacionados')).not.toBeInTheDocument();
    await waitFor(() => expect(client.getQueryState(groupLinksKeys.settings('org-1'))?.status).toBe('error'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('ID do grupo no WhatsApp')).not.toBeInTheDocument();
    view.unmount();
    fail = ''; setup(<RelatedGroups entityType="deal" entityId="deal-1" />);
    await waitFor(() => expect(client.getQueryState(groupLinksKeys.settings('org-1'))?.status).toBe('success'));
    expect(screen.queryByText('Grupos relacionados')).not.toBeInTheDocument();
  });

  it('activates, links multiple contacts independently, searches, handles a denied link and restores preserved links', async () => {
    setup(<><GroupLinksSettings /><GroupRelationsPanel conversationId="conversation-1" /></>);
    const toggle = await screen.findByRole('switch');
    await waitFor(() => expect(toggle).toBeEnabled());
    await userEvent.click(toggle);
    await userEvent.click(await screen.findByRole('button', { name: 'Relacionados no CRM' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Vincular Maria Silva' }));
    failures.add('contact-2');
    await userEvent.click(await screen.findByRole('button', { name: 'Vincular João Costa' }));
    expect(await screen.findByText('Não foi possível salvar este vínculo.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Maria Silva' })).toHaveAttribute('href', '/contacts?contactId=contact-1');
    failures.clear();
    fireEvent.change(screen.getByLabelText('Buscar contatos para vincular'), { target: { value: 'João' } });
    await userEvent.click(await screen.findByRole('button', { name: 'Vincular João Costa' }));
    expect(await screen.findByRole('link', { name: 'João Costa' })).toBeInTheDocument();
    await userEvent.click(toggle);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Relacionados no CRM' })).not.toBeInTheDocument());
    await userEvent.click(toggle);
    await userEvent.click(await screen.findByRole('button', { name: 'Relacionados no CRM' }));
    expect(await screen.findByRole('link', { name: 'Maria Silva' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'João Costa' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Desvincular Maria Silva' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Maria Silva' })).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'João Costa' })).toBeInTheDocument();
  });

  it('shows first principal, copies the full JID and allows the lone remaining group to be explicitly principal', async () => {
    enabled = true;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    setup(<><GroupRelationsPanel conversationId="conversation-1" /><GroupRelationsPanel conversationId="conversation-2" /><RelatedGroups entityType="deal" entityId="deal-1" /></>);
    const panels = await screen.findAllByRole('button', { name: 'Relacionados no CRM' });
    await userEvent.click(panels[0]);
    await userEvent.click(await screen.findByRole('button', { name: 'Vincular Comercial Aurora' }));
    expect(await screen.findByLabelText('ID do grupo no WhatsApp')).toHaveValue(groups[0].externalId);
    expect(screen.getByLabelText('ID do grupo no WhatsApp')).toHaveAttribute('readonly');
    await userEvent.click(screen.getByRole('button', { name: 'Copiar ID do grupo' }));
    expect(writeText).toHaveBeenCalledWith(groups[0].externalId);
    expect(screen.getByRole('link', { name: groups[0].name })).toHaveAttribute('href', '/chats?conversation=conversation-1');
    await userEvent.click(panels[1]);
    const second = panels[1].parentElement!;
    await userEvent.click(await within(second).findByRole('button', { name: 'Vincular Comercial Aurora' }));
    await userEvent.click(await screen.findByRole('button', { name: `Usar ${groups[1].name} como principal` }));
    await waitFor(() => expect(screen.getByLabelText('ID do grupo no WhatsApp')).toHaveValue(groups[1].externalId));
    await userEvent.click(within(second).getByRole('button', { name: 'Desvincular Comercial Aurora' }));
    await waitFor(() => expect(screen.getByLabelText('ID do grupo no WhatsApp')).toHaveValue(''));
    await userEvent.click(screen.getByRole('button', { name: `Usar ${groups[0].name} como principal` }));
    await waitFor(() => expect(screen.getByLabelText('ID do grupo no WhatsApp')).toHaveValue(groups[0].externalId));
  });

  it('refreshes the setting on focus and hides an already loaded section on failure', async () => {
    enabled = true; dealLinks = ['group-1']; primary = 'group-1';
    setup(<RelatedGroups entityType="deal" entityId="deal-1" />);
    expect(await screen.findByRole('link', { name: groups[0].name })).toBeInTheDocument();
    enabled = false;
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true); });
    await waitFor(() => expect(screen.queryByRole('link', { name: groups[0].name })).not.toBeInTheDocument());
    expect(screen.queryByLabelText('ID do grupo no WhatsApp')).not.toBeInTheDocument();
    enabled = true;
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true); });
    expect(await screen.findByRole('link', { name: groups[0].name })).toBeInTheDocument();
    fail = 'settings';
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true); });
    await waitFor(() => expect(screen.queryByLabelText('ID do grupo no WhatsApp')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows read errors with retry when enabled and hides settings controls for sellers', async () => {
    enabled = true; fail = 'relations'; auth.profile.role = 'vendedor';
    setup(<><GroupLinksSettings /><RelatedGroups entityType="contact" entityId="contact-1" /></>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Vínculos indisponíveis.');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    fail = '';
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

function Field({ groups: variables = WEBHOOK_VARIABLE_GROUPS, initial = '' }) {
  const [value, setValue] = useState(initial);
  return <GroupLinksVariableField id="body" value={value} onChange={setValue} groups={variables} aiVars={[]} onAiVarsChange={() => {}} insertLabel="Inserir variável" ariaLabel="Corpo" />;
}
describe('conditional webhook selectors', () => {
  it.each([['pipeline', STAGE_WEBHOOK_VARIABLE_GROUPS], ['agent', WEBHOOK_VARIABLE_GROUPS]])('reveals optional field only after activation in %s and warns for a saved field when off', async (_, groups) => {
    setup(<><GroupLinksSettings /><Field groups={groups} initial={'{"whatsappGroupId":"{{deal.whatsapp_group_id}}"}'} /></>);
    const toggle = await screen.findByRole('switch');
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(screen.getByRole('textbox', { name: 'Corpo' })).toHaveValue('{"whatsappGroupId":"{{deal.whatsapp_group_id}}"}');
    expect(screen.getByText(/Este campo será omitido/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Inserir variável' }));
    expect(screen.queryByRole('button', { name: /ID completo do grupo principal/ })).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(await screen.findByText('ID completo do grupo principal no WhatsApp')).toBeInTheDocument();
    await userEvent.click(toggle);
    await waitFor(() => expect(screen.queryByText('ID completo do grupo principal no WhatsApp')).not.toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: 'Corpo' })).toHaveValue('{"whatsappGroupId":"{{deal.whatsapp_group_id}}"}');
  });
});

function ActualWebhookEditor({ kind }: { kind: 'agent' | 'bot' }) {
  const [hooks, setHooks] = useState<AgentWebhook[]>([{ id: 'hook', event: 'finished', url: 'https://example.com/hook', active: true, secret: null, body_template: '{"group":"{{deal.whatsapp_group_id}}"}' }]);
  const [aiVars, setAiVars] = useState<AgentAiVar[]>([]);
  const [block, setBlock] = useState<BlockOfType<'webhook'>>({ id: 'block', type: 'webhook', data: { url: 'https://example.com/hook', secret: '', body_template: '{"group":"{{deal.whatsapp_group_id}}"}' } });
  return kind === 'agent' ? <WebhooksEditor value={hooks} onChange={setHooks} aiVars={aiVars} onAiVarsChange={setAiVars} /> : <BlockPanel block={block} bubble={{ id: 'bubble', type: 'bubble', position: { x: 0, y: 0 }, data: { name: 'Webhook', blocks: [block] } }} index={0} update={next => setBlock(next as BlockOfType<'webhook'>)} onClose={() => {}} onRemove={() => {}} />;
}
it.each(['agent', 'bot'] as const)('keeps optional variables conditional in the actual %s editor', async kind => {
  setup(<><GroupLinksSettings /><ActualWebhookEditor kind={kind} /></>);
  const toggle = await screen.findByRole('switch');
  await waitFor(() => expect(toggle).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Inserir variável' }));
  expect(screen.queryByText('ID completo do grupo principal no WhatsApp')).not.toBeInTheDocument();
  await userEvent.click(toggle);
  await userEvent.click(await screen.findByText('ID completo do grupo principal no WhatsApp'));
  expect((screen.getByRole('textbox', { name: 'Corpo personalizado do webhook' }) as HTMLTextAreaElement).value).toContain('{{deal.whatsapp_group_id}}');
  await userEvent.click(toggle);
  await userEvent.click(screen.getByRole('button', { name: 'Inserir variável' }));
  expect(screen.queryByText('ID completo do grupo principal no WhatsApp')).not.toBeInTheDocument();
  expect(screen.getByText(/Este campo será omitido/)).toBeInTheDocument();
});

it('offers system variables without unsupported AI authoring in the actual bot block', async () => {
  enabled = true;
  setup(<ActualWebhookEditor kind="bot" />);
  await userEvent.click(screen.getByRole('button', { name: 'Inserir variável' }));
  expect(screen.queryByRole('button', { name: 'Criar variável preenchida pela IA' })).not.toBeInTheDocument();
  expect(await screen.findByText('ID completo do grupo principal no WhatsApp')).toBeInTheDocument();
  const body = screen.getByRole('textbox', { name: 'Corpo personalizado do webhook' }) as HTMLTextAreaElement;
  fireEvent.change(body, { target: { value: '{{ia:resumo}}' } });
  body.setSelectionRange(7, 7);
  await userEvent.click(body);
  expect(screen.queryByRole('dialog', { name: 'Editar variável preenchida pela IA' })).not.toBeInTheDocument();
  expect(body).toHaveValue('{{ia:resumo}}');
});

it('preserves supported agent AI variable creation and stored instruction editing', async () => {
  enabled = true;
  setup(<ActualWebhookEditor kind="agent" />);
  await userEvent.click(screen.getByRole('button', { name: 'Inserir variável' }));
  await userEvent.click(screen.getByRole('button', { name: 'Criar variável preenchida pela IA' }));
  const dialog = screen.getByRole('dialog', { name: 'Criar variável preenchida pela IA' });
  await userEvent.type(within(dialog).getByLabelText('Nome'), 'resumo');
  await userEvent.type(within(dialog).getByLabelText('Instrução para a IA'), 'Resuma o atendimento.');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Criar e inserir' }));
  const body = screen.getByRole('textbox', { name: 'Corpo personalizado do webhook' }) as HTMLTextAreaElement;
  expect(body.value).toContain('{{ia:resumo}}');
  await userEvent.click(screen.getByRole('button', { name: 'Inserir variável' }));
  expect(screen.getByRole('button', { name: /ia:resumo.*Resuma o atendimento/ })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /ia:resumo.*Resuma o atendimento/ }));
  body.setSelectionRange(body.value.indexOf('{{ia:resumo}}') + 6, body.value.indexOf('{{ia:resumo}}') + 6);
  fireEvent.click(body);
  const editor = screen.getByRole('dialog', { name: 'Editar variável preenchida pela IA' });
  expect(within(editor).getByLabelText('Instrução para a IA')).toHaveValue('Resuma o atendimento.');
  fireEvent.change(within(editor).getByLabelText('Instrução para a IA'), { target: { value: 'Resuma a reunião de vendas.' } });
  await userEvent.click(within(editor).getByRole('button', { name: 'Salvar' }));
  await userEvent.click(screen.getByRole('button', { name: 'Inserir variável' }));
  expect(screen.getByRole('button', { name: /ia:resumo.*Resuma a reunião de vendas/ })).toBeInTheDocument();
});

it('retries the intended settings write after a failed PATCH', async () => {
  fail = 'settings-write';
  setup(<GroupLinksSettings />);
  const toggle = await screen.findByRole('switch');
  await waitFor(() => expect(toggle).toBeEnabled());
  await userEvent.click(toggle);
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar a configuração.');
  expect(toggle).toHaveAttribute('aria-checked', 'false');
  fail = '';
  await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
