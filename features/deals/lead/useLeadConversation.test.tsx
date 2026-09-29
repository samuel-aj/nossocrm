import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Deal } from '@/types';
const mocks = vi.hoisted(() => ({ add: vi.fn(), update: vi.fn(), remove: vi.fn(), org: 'org', edit: true }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ organizationId: mocks.org, profile: { name: 'User' } }) }));
vi.mock('@/context/CRMContext', () => ({ useCRM: () => ({ activities: [{ id: 'global', dealId: 'lead', type: 'NOTE', description: 'must not show global body' }], boards: [], customFieldDefinitions: [], addActivity: mocks.add, updateActivity: mocks.update, deleteActivity: mocks.remove, isActivityPending: () => false }) }));
vi.mock('@/lib/permissions/useMyActionPermissions', () => ({ useMyActionPermissions: () => ({ deals: { edit: mocks.edit } }) }));
vi.mock('@/lib/query/hooks', () => ({ useOrgMembers: () => ({ data: [] }) }));
import { useLeadConversation } from './useLeadConversation';
const now = '2026-09-01T00:00:00Z';
const data = { activities: [{ id: 'note', type: 'note', dealId: 'lead', date: now, description: 'paged note' }], nextCursor: null, history: { available: true, since: now, events: [], activityMeta: {}, apiNotes: [{ id: 'api', content: 'readonly API', createdAt: now, updatedAt: null, authorName: null }] } };
function Harness({ id = 'lead' }: { id?: string }) {
 const result = useLeadConversation({ deal: { id, title: 'Lead', boardId: 'board', organizationId: mocks.org } as Deal });
 return <><button onClick={() => result.startActivity({ editingId: "must-reset", type: "CALL", title: "Ligar para o lead", date: "2026-09-28", time: "09:00", description: "" })}>Nova atividade</button>{result.timeline.composerMode === "activity" && result.timeline.activityComposer}{result.timeline.historyPrefix}{result.timeline.entries.map(e => <div key={e.id}>{e.node}</div>)}{result.timeline.noteComposer}{result.dialogs}</>;
}
beforeEach(() => { mocks.org = 'org'; mocks.edit = true; mocks.add.mockResolvedValue({ id: 'new' }); mocks.update.mockResolvedValue(undefined); mocks.remove.mockResolvedValue(undefined); vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(Response.json(data)))); });
afterEach(() => vi.unstubAllGlobals());
function setup() { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>; return { client, wrapper, ...render(<Harness />, { wrapper }) }; }
it('uses paged bodies, keeps API notes readonly and routes note create/edit/delete through CRM only', async () => {
 const { unmount, client } = setup();
 await screen.findByText('paged note');
 expect(screen.queryByText('must not show global body')).toBeNull();
 expect(screen.getAllByLabelText('Editar nota')).toHaveLength(1);
 fireEvent.change(screen.getByRole('textbox', { name: 'Nota interna' }), { target: { value: 'new note' } });
 fireEvent.click(screen.getByRole('button', { name: 'Salvar nota' }));
 await waitFor(() => expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ type: 'NOTE', description: 'new note', dealId: 'lead' })));
 await waitFor(() => expect(screen.getByRole('textbox', { name: 'Nota interna' })).toHaveValue(''));
 fireEvent.click(screen.getByLabelText('Editar nota'));
 const edit = screen.getAllByRole('textbox').find(el => el.getAttribute('aria-label') !== 'Nota interna')!;
 fireEvent.change(edit, { target: { value: 'edited note' } });
 fireEvent.click(screen.getAllByRole('button', { name: 'Salvar nota' })[0]);
 await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('note', { description: 'edited note' }, { throwOnError: true }));
 await waitFor(() => expect(screen.getByLabelText('Excluir nota')).toBeInTheDocument());
 fireEvent.click(screen.getByLabelText('Excluir nota'));
 fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
 await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('note', { throwOnError: true }));
 expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).includes('/timeline'))).toBe(true);
 unmount(); client.clear();
});
it('retains failed note drafts across lead selection and panel remounts', async () => {
 mocks.add.mockResolvedValue(null);
 const { rerender, unmount, wrapper, client } = setup();
 fireEvent.change(screen.getByRole('textbox', { name: 'Nota interna' }), { target: { value: 'keep draft' } });
 fireEvent.click(screen.getByRole('button', { name: 'Salvar nota' }));
 await screen.findByRole('alert');
 rerender(<Harness id="other" />);
 expect(screen.getByRole('textbox', { name: 'Nota interna' })).toHaveValue('');
 rerender(<Harness />);
 expect(screen.getByRole('textbox', { name: 'Nota interna' })).toHaveValue('keep draft');
 unmount(); const again = render(<Harness />, { wrapper });
 expect(screen.getByRole('textbox', { name: 'Nota interna' })).toHaveValue('keep draft');
 again.unmount(); client.clear();
});
it('keeps an edited note open with its text and an error when canonical save fails', async () => {
 mocks.update.mockRejectedValueOnce(new Error('Save failed'));
 const { client, unmount } = setup();
 await screen.findByText('paged note');
 fireEvent.click(screen.getByLabelText('Editar nota'));
 const edit = screen.getAllByRole('textbox').find(el => el.getAttribute('aria-label') !== 'Nota interna')!;
 fireEvent.change(edit, { target: { value: 'unsaved edit' } });
 fireEvent.click(screen.getAllByRole('button', { name: 'Salvar nota' })[0]);
 expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
 expect(edit).toHaveValue('unsaved edit');
 unmount(); client.clear();
});

it('starts a prefilled NEW activity for board schedule hints', async () => {
 const { client, unmount } = setup();
 fireEvent.click(screen.getByRole('button', { name: 'Nova atividade' }));
 expect(screen.getByRole('textbox', { name: 'Título da atividade' })).toHaveValue('Ligar para o lead');
 expect(screen.getByRole('combobox', { name: 'Tipo da atividade' })).toHaveValue('CALL');
 expect(screen.getByRole('button', { name: 'Criar atividade' })).toBeInTheDocument();
 expect(screen.queryByText('Editando atividade.')).toBeNull();
 unmount(); client.clear();
});
