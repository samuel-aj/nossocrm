import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { MessageBubble } from './DealWhatsAppChat';
import type { WaChatMessage } from './useWhatsAppChat';
it('shows the original incoming text struck through and only the edit time', () => {
  const edited = new Date(2026, 8, 17, 8, 50).toISOString();
  const original = new Date(2026, 8, 17, 8, 45).toISOString();
  render(<MessageBubble m={{ id: 'received', direction: 'in', body: 'Beleza Samuel', original_body: 'Beleza', edited_at: edited, created_at: original } as WaChatMessage} />);
  expect(screen.getByLabelText('Mensagem original')).toHaveTextContent('Beleza');
  expect(screen.getByLabelText('Mensagem original')).toHaveClass('line-through');
  expect(screen.getByText('Beleza Samuel')).toBeInTheDocument();
  expect(screen.getByText('Editada 08:50')).toBeInTheDocument();
  expect(screen.queryByText('08:45')).not.toBeInTheDocument();
});

it('shows only the current text for an outgoing edit', () => {
  render(<MessageBubble m={{ id: 'own', direction: 'out', body: 'Corrigida', original_body: 'Antes', edited_at: new Date().toISOString(), created_at: new Date().toISOString() } as WaChatMessage} />);
  expect(screen.queryByText('Antes')).not.toBeInTheDocument();
  expect(screen.getByText('Corrigida')).not.toHaveClass('line-through');
});
it('keeps deleted incoming text struck through and suppresses all actions', () => {
  render(<MessageBubble onAction={() => {}} m={{ id: 'in', direction: 'in', body: 'Último texto', original_body: 'Original', deleted_at: new Date().toISOString(), edited_at: new Date().toISOString(), created_at: new Date().toISOString() } as WaChatMessage} />);
  expect(screen.getByText('Último texto')).toHaveClass('line-through');
  expect(screen.queryByText('Original')).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByText(/^Editada/)).not.toBeInTheDocument();
  expect(screen.getByText(/^Excluída/)).toBeInTheDocument();
});
