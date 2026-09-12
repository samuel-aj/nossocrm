import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Deal } from '@/types';
import { LossDetailsBanner } from './LossDetailsBanner';
const mock = vi.hoisted(() => ({ save: vi.fn(), toast: vi.fn(), reset: vi.fn(), error: null as Error | null }));
vi.mock('./useUpdateLossDetails', () => ({ useUpdateLossDetails: () => ({ mutateAsync: mock.save, reset: mock.reset, isPending: false, isError: !!mock.error, error: mock.error }) }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: mock.toast }) }));
vi.mock('@/lib/query/hooks/useOrgPreferences', () => ({ useOrgPreferences: () => ({ lossReasonsQualified: ['Preço'], lossReasonsDisqualified: ['Contato repetido'] }) }));
const lost = { id: 'lost', title: 'Lead de teste', isLost: true, isWon: false, lossCategory: 'disqualified', lossReason: 'Contato repetido', closedAt: '2026-09-11T12:00:00Z' } as Deal;
beforeEach(() => { mock.save.mockReset().mockResolvedValue({ historyWarning: false }); mock.toast.mockClear(); mock.error = null; });
describe('resumo de perda', () => {
  it('exibe dados gravados, campos ausentes e remove a faixa ao reabrir', () => {
    const { rerender } = render(<LossDetailsBanner deal={lost} canEdit={false} />);
    expect(screen.getByRole('region', { name: 'Dados da perda' })).toHaveTextContent('Desqualificado');
    expect(screen.getByText('Contato repetido', { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Editar classificação/ })).not.toBeInTheDocument();
    rerender(<LossDetailsBanner deal={{ ...lost, lossCategory: undefined, lossReason: undefined, closedAt: undefined }} canEdit={false} />);
    expect(screen.getByRole('region')).toHaveTextContent('Classificação não informada');
    expect(screen.getByRole('region')).toHaveTextContent('Data de encerramento não informada');
    rerender(<LossDetailsBanner deal={{ ...lost, isLost: false }} canEdit={true} />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
  it('edita o motivo sem enviar data, etapa ou status à mutação', async () => {
    render(<LossDetailsBanner deal={lost} canEdit />);
    fireEvent.click(screen.getByRole('button', { name: /Editar classificação/ }));
    expect(screen.getByLabelText('Motivo da perda')).toHaveValue('Contato repetido');
    fireEvent.change(screen.getByLabelText('Motivo da perda'), { target: { value: 'Dados inválidos' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(mock.save).toHaveBeenCalledWith({ lossCategory: 'disqualified', lossReason: 'Dados inválidos' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mock.toast).toHaveBeenCalledWith('Dados da perda atualizados.', 'success');
  });
  it('mantém o rascunho quando o salvamento falha', async () => {
    mock.save.mockRejectedValue(new Error('Falha'));
    render(<LossDetailsBanner deal={lost} canEdit />);
    fireEvent.click(screen.getByRole('button', { name: /Editar classificação/ }));
    fireEvent.change(screen.getByLabelText('Motivo da perda'), { target: { value: 'Correção' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(mock.save).toHaveBeenCalled());
    expect(screen.getByLabelText('Motivo da perda')).toHaveValue('Correção');
    expect(mock.toast).not.toHaveBeenCalled();
  });
});
