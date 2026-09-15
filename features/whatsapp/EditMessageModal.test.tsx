import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditMessageModal } from './EditMessageModal';
import type { WaChatMessage } from './useWhatsAppChat';
const message = { id: 'original-id', body: 'Antes' } as WaChatMessage;
describe('edit message modal', () => {
  it('saves against the original message ID', async () => {
    const save = vi.fn().mockResolvedValue({}), close = vi.fn();
    render(<EditMessageModal message={message} onSave={save} onClose={close} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Depois' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith({ messageId: 'original-id', text: 'Depois' });
  });
  it('preserves the draft and explains a rejected edit', async () => {
    const close = vi.fn();
    render(<EditMessageModal message={message} onSave={vi.fn().mockRejectedValue(new Error('Prazo encerrado'))} onClose={close} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Correção' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Prazo encerrado');
    expect(screen.getByRole('textbox')).toHaveValue('Correção'); expect(close).not.toHaveBeenCalled();
  });
});
