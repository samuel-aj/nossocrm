import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { DealDetailModal } from './DealDetailModal';
import type { Deal } from '@/types';
const detail = vi.hoisted(() => ({ data: null as Deal | null, isLoading: false, isError: false, isSuccess: false, refetch: vi.fn() }));
beforeEach(() => { detail.data = null; detail.isLoading = false; detail.isError = false; detail.isSuccess = false; detail.refetch.mockClear(); });

// Keep this test focused: we only want to ensure opening/closing the modal
// never crashes due to hook-order issues (React error #310).

vi.mock('@/hooks/useResponsiveMode', () => ({
  useResponsiveMode: () => ({ mode: 'desktop' }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    profile: { id: 'user-1', role: 'admin', email: 'test@example.com', organization_id: 'org-1' },
  }),
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({
    addToast: vi.fn(),
  }),
}));

vi.mock('@/lib/query/hooks', () => ({
  useMoveDealSimple: () => ({ moveDeal: vi.fn() }),
  useDeal: () => detail,
  useOrgUsers: () => ({ users: [], isAdmin: false, isLoading: false }),
  useOrgMembers: () => ({ members: [], isLoading: false }),
}));

vi.mock('@/lib/a11y', () => ({
  FocusTrap: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useFocusReturn: () => undefined,
}));

vi.mock('@/components/ConfirmModal', () => ({
  default: () => null,
}));

vi.mock('@/components/ui/LossReasonModal', () => ({
  LossReasonModal: () => null,
}));

vi.mock('../DealSheet', () => ({
  DealSheet: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../StageProgressBar', () => ({
  StageProgressBar: () => null,
}));

vi.mock('@/features/activities/components/ActivityRow', () => ({
  ActivityRow: () => null,
}));

vi.mock('@/lib/ai/tasksClient', () => ({
  analyzeLead: vi.fn(),
  generateEmailDraft: vi.fn(),
  generateObjectionResponse: vi.fn(),
}));

vi.mock('@/context/CRMContext', () => ({
  useCRM: () => {
    const board = {
      id: 'board-1',
      name: 'Pipeline de Vendas',
      stages: [
        { id: 'stage-1', label: 'Novo', order: 0, linkedLifecycleStage: 'MQL' },
      ],
      wonStageId: null,
      lostStageId: null,
      wonStayInStage: false,
      lostStayInStage: false,
      defaultProductId: null,
      agentPersona: null,
      goal: null,
    };

    const deal = {
      id: 'deal-1',
      title: 'Pequeno Chapéu',
      value: 1000,
      status: 'stage-1',
      boardId: 'board-1',
      contactId: 'contact-1',
      companyName: 'Moreira Comércio',
      contactName: 'Fulano',
      contactEmail: 'fulano@example.com',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      probability: 50,
      tags: [],
      items: [],
      customFields: {},
      isWon: false,
      isLost: false,
      closedAt: undefined,
      lossReason: undefined,
    };

    return {
      sidebarCollapsed: false,
      setSidebarCollapsed: vi.fn(),
      deals: [deal],
      contacts: [{ id: 'contact-1', stage: null }],
      updateDeal: vi.fn(),
      deleteDeal: vi.fn(),
      activities: [],
      addActivity: vi.fn(),
      updateActivity: vi.fn(),
      deleteActivity: vi.fn(),
      products: [],
      addItemToDeal: vi.fn(),
      removeItemFromDeal: vi.fn(),
      customFieldDefinitions: [],
      activeBoard: board,
      boards: [board],
      lifecycleStages: [],
    };
  },
}));

describe('DealDetailModal', () => {
  it('does not crash when toggling open/close (hook order regression)', () => {
    const { rerender } = render(
      <DealDetailModal dealId="deal-1" isOpen={false} onClose={() => {}} />,
      { wrapper: ({ children }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider> }
    );

    expect(document.body.textContent).not.toContain('Application error');

    rerender(<DealDetailModal dealId="deal-1" isOpen={true} onClose={() => {}} />);
    expect(document.body.textContent).toContain('Pequeno Chapéu');

    rerender(<DealDetailModal dealId="deal-1" isOpen={false} onClose={() => {}} />);
    expect(document.body.textContent).not.toContain('Application error');
  });
});



it('abre pelo ID um lead ausente da lista filtrada e mostra carregamento até resolver', () => {
  detail.isLoading=true;
  const {rerender}=render(<DealDetailModal dealId="amanda" isOpen onClose={()=>{}} />, {wrapper:({children})=><QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>});
  expect(screen.getByText('Carregando lead…')).toBeInTheDocument();
  detail.isLoading=false;detail.isSuccess=true;
  detail.data={id:'amanda',title:'Amanda',boardId:'board-1',status:'stage-1',contactId:'contact-1',value:0,probability:0,tags:[],items:[],customFields:{},createdAt:'2026-09-03',isWon:false,isLost:false} as unknown as Deal;
  rerender(<DealDetailModal dealId="amanda" isOpen onClose={()=>{}} />);
  expect(screen.getByText('Amanda')).toBeInTheDocument();
  expect(screen.queryByText('Carregando lead…')).not.toBeInTheDocument();
});
it('mostra erro recuperável em vez de carregar indefinidamente um lead inacessível', () => {
  detail.isError=true;
  const onClose=vi.fn();
  render(<DealDetailModal dealId="missing" isOpen onClose={onClose} />, {wrapper:({children})=><QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>});
  expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível abrir este lead');
  expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy','false');
  fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));expect(detail.refetch).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button',{name:'Fechar'}));expect(onClose).toHaveBeenCalledOnce();
});
