import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { CreateDealModal } from './CreateDealModal';
import { CreateDealModalV2 } from './CreateDealModalV2';

const mocks = vi.hoisted(() => ({ addDeal: vi.fn(), close: vi.fn() }));
vi.mock('@/context/CRMContext', () => ({ useCRM: () => ({
  addDeal: mocks.addDeal, activeBoardId: 'board', activeBoard: { id: 'board', stages: [{ id: 'stage', label: 'Novo' }] }, products: [],
}) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user' }, profile: {} }) }));
vi.mock('@/lib/query/hooks', () => ({ useOrgMembers: () => ({ data: [] }) }));
vi.mock('@/lib/query/hooks/useOrgPreferences', () => ({ useOrgPreferences: () => ({ leadSourceOptions: ['Indicação', 'Google Ads'] }) }));
vi.mock('@/components/debug/DebugFillButton', () => ({ DebugFillButton: () => null }));
vi.mock('@/components/ui/ContactSearchCombobox', () => ({ ContactSearchCombobox: ({ onSelectContact }: { onSelectContact: (contact: unknown) => void }) =>
  <button type="button" onClick={() => onSelectContact({ id: 'contact', name: 'Maria', source: 'LINKEDIN' })}>Selecionar Maria</button> }));
beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
  HTMLElement.prototype.scrollIntoView = () => {};
});
beforeEach(() => {
  mocks.addDeal.mockReset().mockResolvedValue({ id: 'new' }); mocks.close.mockClear();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ enabled: false })));
});
afterEach(() => vi.unstubAllGlobals());
it.each([['main', 'Indicação'], ['main', null], ['v2', 'Indicação'], ['v2', null]])('creates through %s with native source %s, never the contact source', async (version, source) => {
  if (version === 'main') {
    render(<CreateDealModal isOpen onClose={mocks.close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar Maria' }));
    fireEvent.change(screen.getByPlaceholderText('Ex: Contrato Anual - Acme'), { target: { value: 'Novo negócio' } });
  } else {
    render(<CreateDealModalV2 isOpen onClose={mocks.close} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome do Negócio' }), { target: { value: 'Novo negócio' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Empresa' }), { target: { value: 'Empresa' } });
  }
  if (source) {
    await userEvent.click(screen.getByRole('combobox', { name: 'Origem do lead' }));
    await userEvent.click(screen.getByRole('option', { name: source }));
  }
  fireEvent.click(screen.getByRole('button', { name: 'Criar Negócio' }));
  await waitFor(() => expect(mocks.addDeal).toHaveBeenCalledOnce());
  expect(mocks.addDeal.mock.calls[0][0]).toMatchObject({ leadSource: source, customFields: {}, title: 'Novo negócio' });
});
