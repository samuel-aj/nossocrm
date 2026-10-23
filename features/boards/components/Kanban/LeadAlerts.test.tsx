import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DealView } from '@/types';
import { BoardAutomationsContext } from '@/features/boards/hooks/useBoardAutomations';
import { DealCard } from './DealCard';
import { KanbanListRow } from './KanbanList';
vi.mock('@/lib/permissions/useMyActionPermissions', () => ({ useMyActionPermissions: () => ({ deals: { move: true } }) }));
vi.mock('./OwnerBadge', () => ({ OwnerBadge: () => <span>Responsável</span> }));
vi.mock('./ActivityStatusIcon', () => ({ ActivityStatusIcon: () => <span>Atividade</span> }));
afterEach(cleanup);
const deal = { id: 'lead', title: 'Lead de demonstração', boardId: 'board', value: 0, tags: [], priority: 'medium', items: [], createdAt: '2026-10-23T10:00:00Z', activeAlert: { id: 'alert', message: 'Nova mensagem', bot_id: 'bot', run_id: 'run', block_id: 'step', created_at: '2026-10-23T11:00:00Z', tone: 'red' } } as DealView;
const block = { conversationId: 'conversation', blockedAt: '2026-10-23T12:00:00Z', reason: 'conversation_token_limit' };
const noop = () => {};
const cardProps = { deal, isRotting: false, activityStatus: { kind: 'none' as const, daysFromToday: 0, daysOverdue: 0 }, isDragging: false, onDragStart: noop, onSelect: noop, isMenuOpen: false, setOpenMenuId: noop, onQuickAddActivity: noop, customFieldDefinitions: [], setLastMouseDownDealId: noop, selectionMode: false, selected: false, onToggleSelect: noop, contactInactive: false };
const rowProps = { deal, stageLabel: 'Qualificado', stages: [], customFieldDefinitions: [], activityStatus: cardProps.activityStatus, isMenuOpen: false, onSelect: noop, onToggleMenu: noop, onQuickAdd: noop, onCloseMenu: noop, isStageMenuOpen: false, onToggleStageMenu: noop, onCloseStageMenu: noop, canEditTags: false, tagSuggestions: [], isTagsMenuOpen: false, onToggleTagsMenu: noop, onCloseTagsMenu: noop, onChangeTags: noop, canAssignOwner: false, assignableMembers: [], isOwnerMenuOpen: false, onToggleOwnerMenu: noop, onCloseOwnerMenu: noop, onChangeOwner: noop };
function context(children: React.ReactNode, blocked = true) {
  return <BoardAutomationsContext.Provider value={{ data: { lead: null }, usageBlocks: blocked ? { lead: block } : {}, loading: false, error: false }}>{children}</BoardAutomationsContext.Provider>;
}
it('highlights the whole card lavender while keeping the red ordinary alert visible and opening unchanged', () => {
  const onSelect = vi.fn();
  const { container } = render(context(<DealCard {...cardProps} onSelect={onSelect} />));
  expect(screen.getByText('Nova mensagem')).toBeInTheDocument();
  expect(screen.getByText('IA pausada por limite')).toBeInTheDocument();
  expect(container.querySelector('[data-deal-id="lead"]')).toHaveClass('bg-violet-50', '!border-l-violet-500');
  fireEvent.click(container.querySelector('[data-deal-id="lead"]')!);
  expect(onSelect).toHaveBeenCalledWith('lead');
  expect(screen.getByText('IA pausada por limite')).toBeInTheDocument();
});
it('preserves legacy green alerts when the independent block clears on refresh', () => {
  const greenDeal = { ...deal, activeAlert: { ...deal.activeAlert!, tone: undefined } };
  const { container, rerender } = render(context(<DealCard {...cardProps} deal={greenDeal} />));
  expect(container.querySelector('[data-deal-id="lead"]')).toHaveClass('bg-violet-50');
  rerender(context(<DealCard {...cardProps} deal={greenDeal} />, false));
  expect(container.querySelector('[data-deal-id="lead"]')).toHaveClass('bg-emerald-50');
  expect(screen.queryByText('IA pausada por limite')).not.toBeInTheDocument();
  expect(screen.getByText('Nova mensagem')).toBeInTheDocument();
});
it('prioritizes lavender in the list and restores the red highlight when the block clears', () => {
  const { container, rerender } = render(context(<table><tbody><KanbanListRow {...rowProps} /></tbody></table>));
  expect(screen.getByText('Nova mensagem')).toBeInTheDocument();
  expect(screen.getByText('IA pausada por limite')).toBeInTheDocument();
  expect(container.querySelector('tr')).toHaveClass('!bg-violet-50');
  rerender(context(<table><tbody><KanbanListRow {...rowProps} /></tbody></table>, false));
  expect(container.querySelector('tr')).toHaveClass('!bg-red-50');
});
