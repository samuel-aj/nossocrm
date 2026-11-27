import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const detail = {
  id: 'r1', status: 'precisa_detalhes', body: 'O botão some', transcript: null, kind: 'bug', public_reply: null,
  tutorial_url: null, created_at: '2026-11-28T12:00:00Z', attachments: [], priority_label: null,
  messages: [{ id: 'm1', author_kind: 'agent', body: 'Em qual tela?', created_at: '2026-11-28T12:05:00Z' }],
};
const query = { data: detail as typeof detail | undefined, isLoading: false, isError: false };
vi.mock('@/lib/query/hooks', () => ({
  useFeedbackDetail: () => query,
  useReplyFeedback: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));

import { FeedbackDetail } from './FeedbackDetail';

describe('FeedbackDetail', () => {
  beforeEach(() => { Object.assign(query, { data: detail, isLoading: false, isError: false }); detail.status = 'precisa_detalhes'; });

  it('mostra a pergunta do agente e o campo de resposta quando precisa de detalhes', () => {
    render(<FeedbackDetail id="r1" />);
    expect(screen.getByText('Em qual tela?')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /sua resposta/i })).toBeTruthy();
  });
  it('esconde o campo de resposta nos outros status', () => {
    detail.status = 'na_fila';
    render(<FeedbackDetail id="r1" />);
    expect(screen.queryByRole('textbox', { name: /sua resposta/i })).toBeNull();
  });
  it('avisa quando não consegue abrir o pedido, em vez de ficar carregando', () => {
    Object.assign(query, { data: undefined, isLoading: false, isError: true });
    render(<FeedbackDetail id="r1" />);
    expect(screen.getByText('Não foi possível abrir este pedido.')).toBeTruthy();
    expect(screen.queryByText('Carregando…')).toBeNull();
  });
  it('mostra carregando enquanto busca', () => {
    Object.assign(query, { data: undefined, isLoading: true, isError: false });
    render(<FeedbackDetail id="r1" />);
    expect(screen.getByText('Carregando…')).toBeTruthy();
  });
});
