import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Board, Deal } from '@/types';
import { DealStageControl } from './DealStageControl';

const mocks = vi.hoisted(() => ({
  boards: [] as Board[],
  mutateAsync: vi.fn(),
  addToast: vi.fn(),
  canMove: true,
}));
vi.mock('@/context/CRMContext', () => ({ useCRM: () => ({ boards: mocks.boards, lifecycleStages: [] }) }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: mocks.addToast }) }));
vi.mock('@/lib/query/hooks/useMoveDeal', () => ({ useMoveDeal: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }) }));
vi.mock('@/lib/permissions/useMyActionPermissions', () => ({ useMyActionPermissions: () => ({ deals: { move: mocks.canMove } }) }));
vi.mock('@/lib/query/hooks/useOrgPreferences', () => ({ useOrgPreferences: () => ({ lossReasonsQualified: null, lossReasonsDisqualified: null }) }));

const source = { id: 'source', name: 'Origem', stages: [{ id: 'current', label: 'Atual', color: 'bg-blue-500' }, { id: 'same', label: 'Outra', color: 'bg-blue-500' }] } as Board;
const target = { id: 'target', name: 'Destino', stages: [{ id: 'destination', label: 'Etapa destino', color: 'bg-green-500' }, { id: 'lost', label: 'Perdida', color: 'bg-red-500' }], lostStageId: 'lost' } as Board;
const deal = { id: 'deal', title: 'Lead', boardId: 'source', status: 'current', isWon: false, isLost: false } as Deal;
function pick(boardName: string, stageName: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: /Origem/ }));
  fireEvent.click(screen.getByRole('option', { name: boardName }));
  fireEvent.click(screen.getByRole('option', { name: stageName }));
}
function setup(currentDeal = deal) { return render(<DealStageControl deal={currentDeal} />); }

beforeEach(() => {
  mocks.boards = [source, target];
  mocks.canMove = true;
  mocks.mutateAsync.mockReset().mockResolvedValue({});
  mocks.addToast.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});

describe('DealStageControl', () => {
  it('asks before moving across funnels and cancellation has no effects', () => {
    setup();
    pick('Destino', /Etapa destino/);
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Deseja mudar lead de funil?');
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Origem');
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Destino');
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it('does not move while only browsing another funnel', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Origem/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Destino' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it('moves within the same funnel directly', async () => {
    setup();
    pick('Origem', /Outra/);
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledOnce());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('confirms once even on a double click', async () => {
    setup();
    pick('Destino', /Etapa destino/);
    const confirm = screen.getByRole('button', { name: 'Confirmar mudança de funil' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledOnce());
    expect(mocks.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ dealId: 'deal', targetStageId: 'destination', board: target }));
  });

  it.each(['source', 'source board', 'deal', 'destination'] as const)('cancels when %s becomes stale', async stale => {
    const view = setup();
    pick('Destino', /Etapa destino/);
    if (stale === 'source') view.rerender(<DealStageControl deal={{ ...deal, status: 'same' }} />);
    if (stale === 'source board') view.rerender(<DealStageControl deal={{ ...deal, boardId: 'target' }} />);
    if (stale === 'deal') view.rerender(<DealStageControl deal={{ ...deal, id: 'other' }} />);
    if (stale === 'destination') { mocks.boards = [source, { ...target, stages: [] }]; view.rerender(<DealStageControl deal={deal} />); }
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar mudança de funil' }));
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it('asks for a loss reason after confirming a cross-funnel lost stage and can cancel it', () => {
    setup();
    pick('Destino', /Perdida/);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar mudança de funil' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Tipo de Perda');
    fireEvent.click(screen.getByRole('button', { name: 'Fechar modal' }));
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it('revalidates the source during the loss reason flow', () => {
    const view = setup();
    pick('Destino', /Perdida/);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar mudança de funil' }));
    view.rerender(<DealStageControl deal={{ ...deal, status: 'same' }} />);
    fireEvent.click(screen.getByRole('button', { name: /Lead Qualificado/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Preço' }));
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it('revalidates permission before confirmation', () => {
    const view = setup();
    pick('Destino', /Etapa destino/);
    mocks.canMove = false;
    view.rerender(<DealStageControl deal={deal} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar mudança de funil' }));
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it('blocks selection without permission', () => {
    mocks.canMove = false;
    setup();
    expect(screen.getByRole('button', { name: /Origem/ })).toBeDisabled();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it('shows server failure without claiming a move', async () => {
    mocks.mutateAsync.mockRejectedValue(new Error('denied'));
    setup();
    pick('Destino', /Etapa destino/);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar mudança de funil' }));
    await waitFor(() => expect(mocks.addToast).toHaveBeenCalledWith(expect.stringContaining('Nada foi alterado'), 'error'));
  });

  it('cancels with Escape and returns focus to picker', async () => {
    setup();
    pick('Destino', /Etapa destino/);
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: /Origem/ })).toHaveFocus());
  });
});

it("names the lead and separates source/destination in confirmation", () => {
 setup(); pick('Destino', /Etapa destino/);
 const dialog = screen.getByRole('alertdialog');
 expect(dialog).toHaveTextContent('Você vai mover Lead para outro funil.');
 expect(dialog).toHaveTextContent('De: Origem → Atual');
 expect(dialog).toHaveTextContent('Para: Destino → Etapa destino');
});
it.each([undefined, 'LEAD', 'MQL', 'SALES_QUALIFIED', 'CUSTOMER'])('announces only applicable effects for %s', lifecycle => {
 mocks.boards = [source, { ...target, nextBoardId: 'next', stages: [{ ...target.stages[0], linkedLifecycleStage: lifecycle }] } as Board];
 setup(); pick('Destino', /Etapa destino/);
 expect(screen.queryByText(/etapa do contato poderá/)).toBeNull();
 expect(!!screen.queryByText(/próximo funil/)).toBe(['MQL', 'SALES_QUALIFIED', 'CUSTOMER'].includes(lifecycle || ''));
});
it.each([
  { lifecycle: 'CUSTOMER', wonStageId: 'another', expected: true },
  { lifecycle: 'LEAD', wonStageId: 'destination', expected: false },
  { lifecycle: 'CUSTOMER', linkedLifecycleStage: 'CUSTOMER', expected: false },
])('uses Customer identity for sales and explicit completion for customer boards ($lifecycle)', ({ lifecycle, wonStageId, linkedLifecycleStage, expected }) => {
  mocks.boards = [source, { ...target, nextBoardId: 'next', wonStageId, linkedLifecycleStage, stages: [{ ...target.stages[0], linkedLifecycleStage: lifecycle }] } as Board];
  setup({ ...deal, contactId: 'contact' }); pick('Destino', /Etapa destino/);
  expect(screen.getByText(/etapa do contato poderá/)).toBeInTheDocument();
  expect(!!screen.queryByText(/próximo funil/)).toBe(expected);
});

it('reopens a closed lead explicitly when selecting its own Customer stage', async () => {
  mocks.boards = [{ ...source, stages: [{ ...source.stages[0], linkedLifecycleStage: 'CUSTOMER' }] }];
  setup({ ...deal, isWon: true });
  pick('Origem', /Atual/);
  await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ targetStageId: 'current', explicitReopen: true, explicitWin: false })));
});

it('keeps an explicit archive win in its current stage even with a Customer destination', async () => {
  mocks.boards = [{ ...source, wonStayInStage: true, wonStageId: 'same', stages: [...source.stages, { id: 'customer', label: 'Contrato', color: 'bg-green-500', linkedLifecycleStage: 'CUSTOMER' }] }];
  setup();
  pick('Origem', /^Ganho$/);
  await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ targetStageId: 'current', explicitWin: true })));
});
