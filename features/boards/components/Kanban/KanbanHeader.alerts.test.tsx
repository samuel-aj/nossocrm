import React, { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { KanbanHeader } from './KanbanHeader';
import { EMPTY_GENERAL, EMPTY_PERIOD, type GeneralSettings } from '../../filters/boardFilters';
import type { Board } from '@/types';
vi.mock('@/context/CRMContext', () => ({ useCRM: () => ({ products: [] }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'seller' } }) }));
vi.mock('@/lib/query/hooks', () => ({ useOrgUsers: () => ({ users: [] }) }));
vi.mock('@/lib/permissions/useMyActionPermissions', () => ({ useMyActionPermissions: () => ({ deals: { create: true } }) }));
vi.mock('../BoardSelector', () => ({ BoardSelector: () => null }));
afterEach(cleanup);
function Header() {
  const [general, setGeneralState] = useState<GeneralSettings>({ ...EMPTY_GENERAL, alertsOnly: true });
  const setGeneral = (patch: Partial<GeneralSettings>) => setGeneralState(current => ({ ...current, ...patch }));
  const board = { id: 'board', name: 'Vendas', stages: [] } as unknown as Board;
  return <KanbanHeader boards={[board]} activeBoard={board} onSelectBoard={vi.fn()} onCreateBoard={vi.fn()}
    viewMode="kanban" setViewMode={vi.fn()} searchTerm="" setSearchTerm={vi.fn()}
    ownerFilter={general.owner} setOwnerFilter={owner => setGeneral({ owner })}
    statusFilter={general.status} setStatusFilter={status => setGeneral({ status })}
    tagFilter={general.tag} setTagFilter={tag => setGeneral({ tag })} tagOptions={[]}
    customFieldConditions={general.conditions} setCustomFieldConditions={conditions => setGeneral({ conditions })}
    customFieldLogic={general.logic} setCustomFieldLogic={logic => setGeneral({ logic })} customFieldOptions={[]}
    filterControls={{ general, setGeneral, period: EMPTY_PERIOD, setPeriod: vi.fn(), saved: { general: null, period: null }, pin: vi.fn(), saving: false, ready: true, loading: false, loadError: false }}
    onNewDeal={vi.fn()} selectionMode={false} onEnterSelectionMode={vi.fn()} onExitSelectionMode={vi.fn()} />;
}
it('ignores the retired alert preference in the controls and active count', () => {
  render(<Header />);
  fireEvent.click(screen.getByRole('button', { name: 'Filtros' }));
  expect(screen.queryByRole('checkbox', { name: 'Com alertas' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Limpar/ })).not.toBeInTheDocument();
});

it('selects and clears automation without retaining the active count', async () => {
  Element.prototype.scrollIntoView = vi.fn();
  render(<Header />);
  fireEvent.click(screen.getByRole('button', { name: 'Filtros' }));
  const combo = screen.getByRole('combobox', { name: 'Filtrar por automação' });
  fireEvent.keyDown(combo, { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: 'Robô em andamento' }));
  expect(combo).toHaveTextContent('Robô em andamento');
  fireEvent.click(screen.getByRole('button', { name: 'Limpar (1)' }));
  expect(combo).toHaveTextContent('Todas');
  expect(screen.queryByRole('button', { name: /Limpar/ })).not.toBeInTheDocument();
});
