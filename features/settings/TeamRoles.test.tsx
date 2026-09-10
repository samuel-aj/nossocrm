import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({}) }));
vi.mock('@/components/ui/Modal', () => ({ useModalOverlay: () => {}, Modal: ({ isOpen, title, children }: { isOpen: boolean; title: string; children: React.ReactNode }) => isOpen ? <div role="dialog" aria-label={title}>{children}</div> : null }));
import { TeamRolesPanel, MemberAccess, type TeamConfig } from './TeamRoles';
const id = '11111111-1111-4111-8111-111111111111';
const member = { id, email: 'member@example.test', role: 'vendedor' };
const config: TeamConfig = { canManage: true, isSuperAdmin: false, masterUserId: null, roles: [], assignments: [], availableBoards: [{ id, name: 'Funil A' }, { id: '22222222-2222-4222-8222-222222222222', name: 'Funil B' }] };
function mount(content: React.ReactNode) { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{content}</QueryClientProvider>); }
describe('team access configuration', () => {
  beforeEach(() => { cleanup(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })); });
  it('saves a single funnel, own visibility and independent move permission', async () => {
    mount(<TeamRolesPanel config={config} members={[member]} onSaved={() => {}} />);
    fireEvent.click(screen.getByText('Nova função'));
    fireEvent.change(screen.getByPlaceholderText('Ex.: Atendimento BPC'), { target: { value: 'Atendimento A' } });
    fireEvent.click(screen.getByLabelText('Funil A'));
    fireEvent.click(screen.getByLabelText('Mover entre etapas'));
    fireEvent.click(screen.getByText('Salvar função'));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const init = vi.mocked(fetch).mock.calls[0][1];
    expect(JSON.parse(String(init?.body))).toEqual({ action: 'saveRole', data: { name: 'Atendimento A', description: '', boards: [{ boardId: id, scope: 'own', create: false, edit: false, move: true, delete: false }] } });
  });
  it('opens the visibility dropdown by keyboard and saves all leads', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    mount(<TeamRolesPanel config={config} members={[member]} onSaved={() => {}} />);
    fireEvent.click(screen.getByText('Nova função'));
    fireEvent.change(screen.getByPlaceholderText('Ex.: Atendimento BPC'), { target: { value: 'Todos A' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Funil A' }));
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Leads visíveis em Funil A' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: 'Todos os leads deste funil' }));
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(screen.getByText('Salvar função'));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).data.boards[0].scope).toBe('all');
  });
  it('ordinary administrators see team information without management controls', () => {
    mount(<TeamRolesPanel config={{ ...config, canManage: false }} members={[member]} onSaved={() => {}} />);
    expect(screen.queryByText('Nova função')).toBeNull();
    expect(screen.queryByText('Definir Mestre')).toBeNull();
    expect(screen.getByText(/gestão de membros/)).toBeTruthy();
  });
  it('only technical administrators get master selection', () => {
    mount(<TeamRolesPanel config={{ ...config, isSuperAdmin: true }} members={[member]} onSaved={() => {}} />);
    fireEvent.click(screen.getByText('Definir Mestre'));
    expect(screen.getByRole('dialog', { name: 'Definir Administrador Mestre' })).toBeTruthy();
  });
  it('current master has no demotion control and new members show denied access', () => {
    const view = mount(<MemberAccess member={member} config={{ ...config, masterUserId: id }} onSaved={() => {}} />);
    expect(screen.queryByText('Alterar função')).toBeNull();
    expect(screen.getByText('Administrador Mestre')).toBeTruthy();
    view.unmount();
    mount(<MemberAccess member={member} config={config} onSaved={() => {}} />);
    expect(screen.getByText('Sem acesso a funis')).toBeTruthy();
  });
});
