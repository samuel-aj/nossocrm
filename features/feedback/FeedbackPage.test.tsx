import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const nav = vi.hoisted(() => ({ params: new URLSearchParams('pedido=r1') }));
vi.mock('next/navigation', () => ({ useSearchParams: () => nav.params }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { role: 'user' } }) }));
vi.mock('@/lib/query/hooks', () => ({
  useMyFeedback: () => ({ data: [], isLoading: false, isError: false }),
  useAllFeedback: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock('./components/FeedbackComposer', () => ({ FeedbackComposer: () => null }));
vi.mock('./components/FeedbackDetail', () => ({ FeedbackDetail: ({ id }: { id: string }) => <p>pedido aberto: {id}</p> }));

import { FeedbackPage } from './FeedbackPage';

describe('FeedbackPage', () => {
  it('abre o pedido do link e troca quando o ?pedido= muda com a página aberta (clique no sino)', () => {
    const { rerender } = render(<FeedbackPage />);
    expect(screen.getByText('pedido aberto: r1')).toBeTruthy();
    nav.params = new URLSearchParams('pedido=r2');
    rerender(<FeedbackPage />);
    expect(screen.getByText('pedido aberto: r2')).toBeTruthy();
  });
});
