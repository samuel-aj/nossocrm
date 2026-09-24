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
  const [general, setGeneralState] = useState<GeneralSettings>(EMPTY_GENERAL);
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
it('selects and clears Com alertas without retaining the merged filter or active count', () => {
  render(<Header />);
  fireEvent.click(screen.getByRole('button', { name: 'Filtros' }));
  const checkbox = screen.getByRole('checkbox', { name: 'Com alertas' });
  expect(checkbox).not.toBeChecked();
  expect(checkbox.closest('label')?.parentElement?.closest('label')).toBeNull();
  fireEvent.click(checkbox);
  expect(checkbox).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Limpar (1)' }));
  expect(checkbox).not.toBeChecked();
  expect(screen.queryByRole('button', { name: /Limpar/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Filtros' })).not.toHaveTextContent('1');
});
