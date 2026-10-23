import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ canGrant: true, grant: vi.fn() }));
vi.mock('./useAiUsage', () => ({
  useConversationUsage: () => ({ isPending: false, data: { canGrant: h.canGrant, grants: [], budget: {
    account_id: 'account', blocked_at: '2026-10-23T00:00:00Z', blocked_reason: 'conversation_token_limit', tokens_used: 900, tokens_reserved: 100, tokens_granted: 0, seconds_used: 20, seconds_reserved: 0, seconds_granted: 0,
    policy: { enabled: true, conversation_tokens: 1000 },
  } } }),
  useGrantUsage: () => ({ mutateAsync: h.grant, isPending: false, error: null }),
}));
import { ConversationBudget } from './ConversationBudget';
beforeEach(() => { h.canGrant = true; h.grant.mockReset(); });
describe('conversation spending dialog', () => {
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
