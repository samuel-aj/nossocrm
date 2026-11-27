import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FeedbackList } from './FeedbackList';

describe('FeedbackList', () => {
  it('avisa quando a lista não carrega, em vez de dizer que não há pedidos', () => {
    render(<FeedbackList rows={[]} isLoading={false} isError selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toBe('Não foi possível carregar os pedidos.');
    expect(screen.queryByText('Nenhum pedido ainda.')).toBeNull();
  });
  it('sem erro e sem pedidos, mostra a lista vazia', () => {
    render(<FeedbackList rows={[]} isLoading={false} isError={false} selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getByText('Nenhum pedido ainda.')).toBeTruthy();
  });
});
