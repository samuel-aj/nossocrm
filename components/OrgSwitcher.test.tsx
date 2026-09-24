import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrgSwitcher } from './OrgSwitcher';
import { FocusTrap } from '@/lib/a11y';

vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: null }));
vi.mock('./MainOrganizationShortcut', () => ({ MainOrganizationShortcut: () => null }));
afterEach(() => vi.unstubAllGlobals());

function mount() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ organizations: [{ id: 'home', name: 'Anúncio Jurídico' }, { id: 'client', name: 'Cliente' }] }) }));
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <aside><OrgSwitcher collapsed isSuperAdmin currentOrgId="home" officeName="Anúncio Jurídico" officeInitials="AJ" /></aside>
    <FocusTrap active initialFocus={false}><input aria-label="Descrição do lead" /><button>Fechar lead</button></FocusTrap>
  </QueryClientProvider>);
}

describe('organizações sobre o lead', () => {
  it('abre fora da sidebar, permite buscar e devolve o foco ao fechar com Escape', async () => {
    const { container } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Trocar organização' }));
    const menu = screen.getByRole('dialog', { name: 'Organizações' });
    expect(container).not.toContainElement(menu);
    const search = screen.getByRole('textbox', { name: 'Buscar organização' });
    await waitFor(() => expect(search).toHaveFocus());
    await screen.findByRole('button', { name: /Cliente/ });
    fireEvent.change(search, { target: { value: 'Cliente' } });
    expect(screen.queryByRole('button', { name: /Anúncio Jurídico/ })).not.toBeInTheDocument();
    fireEvent.keyDown(search, { key: 'Escape', code: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Organizações' })).not.toBeInTheDocument();
    screen.getByRole('textbox', { name: 'Descrição do lead' }).focus();
    expect(screen.getByRole('textbox', { name: 'Descrição do lead' })).toHaveFocus();
  });
  it('mantém aberto ao clicar na busca e fecha ao clicar fora', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Trocar organização' }));
    fireEvent.mouseDown(screen.getByRole('textbox', { name: 'Buscar organização' }));
    expect(screen.getByRole('dialog', { name: 'Organizações' })).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Fechar lead' }));
    expect(screen.queryByRole('dialog', { name: 'Organizações' })).not.toBeInTheDocument();
  });
});
