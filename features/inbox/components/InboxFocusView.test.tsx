import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { FocusItem } from '../hooks/useInboxController';

const mocks = vi.hoisted(() => ({ addActivity: vi.fn(), crm: {} as Record<string, unknown> }));
vi.mock('@/context/CRMContext', () => ({ useCRM: () => mocks.crm }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { first_name: 'Ana' } }) }));
vi.mock('@/lib/query/hooks', () => ({ useMoveDealSimple: () => ({ moveDeal: vi.fn() }) }));
// O painel real é grande; aqui só interessa o que a Inbox entrega a ele e o que
// ela faz com o registro que ele devolve. O dublê imita o registro de ligação,
// o único que manda o id do negócio aberto (agendamento, sugestão e nota não mandam).
vi.mock('./FocusContextPanel', () => ({
  FocusContextPanel: ({ deal, onAddActivity }: { deal: { id: string }; onAddActivity: (activity: object) => void }) => (
    <button onClick={() => onAddActivity({ dealId: deal.id, type: 'CALL', title: 'Ligação' })}>
      registrar ligação em {deal.id}
    </button>
  ),
}));
import { InboxFocusView } from './InboxFocusView';

const contact = { id: '3f2b8c1e-5d4a-4c9b-9e7a-1b2c3d4e5f60', name: 'Cliente Teste' };
const realDeal = { id: 'a1b2c3d4-e5f6-8a7b-9c0d-1e2f3a4b5c6d', title: 'Lead real', contactId: contact.id, boardId: 'board', status: 'stage' };
const navigation = { currentIndex: 0, totalItems: 1, onDone: vi.fn(), onSnooze: vi.fn(), onSkip: vi.fn(), onPrev: vi.fn(), onNext: vi.fn() };
const suggestionFor = (data: object) => ({
  id: 'item', type: 'suggestion', priority: 0,
  data: { id: 'suggestion', type: 'RESCUE', title: 'Risco de churn', description: 'Sem contato há 30 dias', priority: 'medium', data, createdAt: '2026-11-25T12:00:00.000Z' },
}) as unknown as FocusItem;

function openContext(item: FocusItem, deals: object[]) {
  mocks.crm = { deals, contacts: [contact], companies: [], boards: [], activeBoard: null, activities: [],
    updateDeal: vi.fn(), addActivity: mocks.addActivity, updateActivity: vi.fn(), setSidebarCollapsed: vi.fn() };
  render(<InboxFocusView currentItem={item} {...navigation} />);
  fireEvent.click(screen.getByText('Ver detalhes'));
}

describe('registro de ligação entregue pela Inbox ao salvar no painel de contexto', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sai sem negócio quando o contato não tem lead e o painel abre com o negócio fictício', () => {
    openContext(suggestionFor({ contact }), []);

    fireEvent.click(screen.getByRole('button', { name: `registrar ligação em placeholder-${contact.id}` }));

    expect(mocks.addActivity).toHaveBeenCalledTimes(1);
    expect(mocks.addActivity).toHaveBeenCalledWith({ dealId: '', type: 'CALL', title: 'Ligação' });
  });

  it('leva o id do negócio quando o lead existe', () => {
    openContext(suggestionFor({ deal: realDeal, contact }), [realDeal]);

    fireEvent.click(screen.getByRole('button', { name: `registrar ligação em ${realDeal.id}` }));

    expect(mocks.addActivity).toHaveBeenCalledTimes(1);
    expect(mocks.addActivity).toHaveBeenCalledWith({ dealId: realDeal.id, type: 'CALL', title: 'Ligação' });
  });
});
