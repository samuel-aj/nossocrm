import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const h = vi.hoisted(() => ({ canGrant: true, grant: vi.fn(), reason: 'conversation_token_limit', used: 900, reserved: 100, quota: 1000 }));
vi.mock('./useAiUsage', () => ({
  useConversationUsage: () => ({ isPending: false, data: { canGrant: h.canGrant, grants: [], budget: {
    account_id: 'account', blocked_at: '2026-10-23T00:00:00Z', blocked_reason: h.reason, tokens_used: h.used, tokens_reserved: h.reserved, tokens_granted: 0, seconds_used: 20, seconds_reserved: 0, seconds_granted: 0,
    policy: { enabled: true, conversation_tokens: h.quota },
  } } }),
  useGrantUsage: () => ({ mutateAsync: h.grant, isPending: false, error: null }),
}));
import { ConversationBudget } from './ConversationBudget';
beforeEach(() => { h.canGrant = true; h.grant.mockReset(); h.reason = 'conversation_token_limit'; h.used = 900; h.reserved = 100; h.quota = 1000; });
describe('conversation spending dialog', () => {
  it('shows the pending reserve and cause even when the conversation has a positive balance', () => {
    h.reason = 'usage_unknown'; h.used = 73082; h.reserved = 99804; h.quota = 300000;
    render(<ConversationBudget conversationId="chat" />);
    expect(screen.getByText('IA pausada: consumo pendente')).toBeVisible();
    expect(screen.getByText('73.082 tokens usados · 99.804 reservados · 127.114 disponíveis')).toBeVisible();
    expect(screen.getByText(/O provedor não confirmou/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Ver consumo e liberar' }));
    expect(within(screen.getByRole('dialog')).getByText(/O provedor não confirmou/)).toBeVisible();
    expect(h.grant).not.toHaveBeenCalled();
  });
  it('explains a provider credit refusal in the banner and dialog without claiming that CRM tokens ran out', () => {
    h.reason = 'provider_insufficient_quota'; h.reserved = 0;
    render(<ConversationBudget conversationId="chat" />);
    expect(screen.getByText('IA pausada: limite da API')).toBeVisible();
    expect(screen.getByText('900 tokens usados · 100 disponíveis')).toBeVisible();
    expect(screen.getByText(/aumentar o limite de tokens no CRM não resolve/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Ver consumo e liberar' }));
    expect(within(screen.getByRole('dialog')).getByText(/Regularize os créditos ou o limite da conta no provedor/)).toBeVisible();
    expect(h.grant).not.toHaveBeenCalled();
  });
  it('preserves the human path and only authorized staff see the grant form', () => {
    h.canGrant = false; render(<ConversationBudget conversationId="chat" />);
    expect(screen.getByText('IA pausada por limite')).toBeVisible();
    expect(screen.getByText(/continuar o atendimento humano/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ver consumo' }));
    expect(screen.queryByRole('button', { name: 'Confirmar liberação' })).toBeNull();
    expect(screen.getByText(/Somente o responsável/)).toBeTruthy();
  });
  it('retries the same grant idempotently and never invokes an automatic send', async () => {
    h.grant.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({});
    render(<ConversationBudget conversationId="chat" />);
    fireEvent.click(screen.getByRole('button', { name: 'Ver consumo e liberar' }));
    fireEvent.change(screen.getByLabelText('Tokens'), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Continuar atendimento aprovado' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar liberação' }));
    await waitFor(() => expect(h.grant).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar liberação' }));
    await waitFor(() => expect(h.grant).toHaveBeenCalledTimes(2));
    expect(h.grant.mock.calls[0][0].idempotencyKey).toEqual(h.grant.mock.calls[1][0].idempotencyKey);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Retome a IA pelo botão Retomar'));
  });
  it('resets a partially filled grant when the selected conversation changes', () => {
    const view = render(<ConversationBudget conversationId="first" />);
    fireEvent.click(screen.getByRole('button', { name: 'Ver consumo e liberar' }));
    fireEvent.change(screen.getByLabelText('Tokens'), { target: { value: '1000' } });
    view.rerender(<ConversationBudget conversationId="second" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ver consumo e liberar' }));
    expect((screen.getByLabelText('Tokens') as HTMLInputElement).value).toBe('');
  });
});
