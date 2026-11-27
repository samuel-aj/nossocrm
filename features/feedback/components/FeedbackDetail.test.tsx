import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const detail = {
  id: 'r1', status: 'precisa_detalhes', body: 'O botão some', transcript: null, kind: 'bug', public_reply: null,
  tutorial_url: null, created_at: '2026-11-28T12:00:00Z', attachments: [], priority_label: null,
  messages: [{ id: 'm1', author_kind: 'agent', body: 'Em qual tela?', created_at: '2026-11-28T12:05:00Z' }],
};
vi.mock('@/lib/query/hooks', () => ({
  useFeedbackDetail: () => ({ data: detail, isLoading: false }),
  useReplyFeedback: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));

import { FeedbackDetail } from './FeedbackDetail';

describe('FeedbackDetail', () => {
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
});
