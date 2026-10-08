import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DealCard } from './DealCard';
import { KanbanListRow, NO_ACTIVITY_STATUS } from './KanbanList';
import type { CustomFieldDefinition, DealView } from '@/types';

vi.mock('@/lib/permissions/useMyActionPermissions', () => ({ useMyActionPermissions: () => ({ deals: { move: true } }) }));
vi.mock('./OwnerBadge', () => ({ OwnerBadge: () => null }));
vi.mock('./ActivityStatusIcon', () => ({ ActivityStatusIcon: () => null }));

const noop = vi.fn();
const definitions = [{ id: 'source', key: 'origem', label: 'Origem', type: 'select', entity_type: 'deal' }] as unknown as CustomFieldDefinition[];
const baseDeal = {
  id: 'lead', title: 'Oportunidade', boardId: 'board', status: 'new', value: 0,
  tags: [], items: [], owner: { name: 'Responsável', avatar: '' }, createdAt: '2026-10-08T12:00:00Z',
  updatedAt: '2026-10-08T12:00:00Z', customFields: { origem: 'Meta Ads' },
} as unknown as DealView;

describe.each(['card', 'list'] as const)('native origin displayed in %s', surface => {
  it.each([[undefined, 'Meta Ads'], [null, null], ['Indicação', 'Indicação']] as const)('shows %s without restoring old origin', (leadSource, expected) => {
    const deal = { ...baseDeal, leadSource };
    if (surface === 'card') {
      render(<DealCard deal={deal} customFieldDefinitions={definitions} activityStatus={NO_ACTIVITY_STATUS}
        isRotting={false} isDragging={false} isMenuOpen={false} selectionMode={false} selected={false} contactInactive={false}
        onDragStart={noop} onSelect={noop} setOpenMenuId={noop} onQuickAddActivity={noop} setLastMouseDownDealId={noop} onToggleSelect={noop} />);
    } else {
      render(<table><tbody><KanbanListRow deal={deal} stageLabel="Novo" stages={[]} customFieldDefinitions={definitions}
        activityStatus={NO_ACTIVITY_STATUS} isMenuOpen={false} onSelect={noop} onToggleMenu={noop} onQuickAdd={noop} onCloseMenu={noop}
        isStageMenuOpen={false} onToggleStageMenu={noop} onCloseStageMenu={noop} canEditTags={false} tagSuggestions={[]}
        isTagsMenuOpen={false} onToggleTagsMenu={noop} onCloseTagsMenu={noop} onChangeTags={noop} canAssignOwner={false} assignableMembers={[]}
        isOwnerMenuOpen={false} onToggleOwnerMenu={noop} onCloseOwnerMenu={noop} onChangeOwner={noop} /></tbody></table>);
    }
    if (expected) expect(screen.getByText(expected)).toBeInTheDocument();
    if (leadSource !== undefined) expect(screen.queryByText('Meta Ads')).not.toBeInTheDocument();
  });
});
