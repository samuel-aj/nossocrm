import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuotedBlock } from './QuotedBlock';
import type { WaChatMessage } from './useWhatsAppChat';

const quote = { provider_id: 'original-id', body: 'Prévia armazenada', media_type: null,
  direction: 'in' as const, sender_name: 'Maria' };

describe('QuotedBlock', () => {
  it('shows the stored preview and known author without the original loaded', () => {
    render(<QuotedBlock q={quote} isOut={false} isGroup contactName="Nome do grupo" original={null} />);
    expect(screen.getByText('Maria')).toBeInTheDocument();
    expect(screen.getByText('Prévia armazenada')).toBeInTheDocument();
    expect(screen.queryByText('Nome do grupo')).not.toBeInTheDocument();
  });

  it('does not invent group author when unknown', () => {
    render(<QuotedBlock q={{ ...quote, sender_name: undefined }} isOut={false} isGroup original={null} />);
    expect(screen.getByText('Participante')).toBeInTheDocument();
  });

  it('marks a known deleted original unavailable and does not jump to it', () => {
    const onJump = vi.fn();
    const { container } = render(<QuotedBlock q={quote} isOut={false} original={{ deleted_at: '2026-09-28' } as WaChatMessage} onJump={onJump} />);
    expect(screen.getByText('Mensagem indisponível')).toBeInTheDocument();
    expect(screen.queryByText('Prévia armazenada')).not.toBeInTheDocument();
    fireEvent.click(container.firstElementChild as Element);
    expect(onJump).not.toHaveBeenCalled();
  });

  it('jumps to a live loaded original by keyboard', () => {
    const onJump = vi.fn();
    render(<QuotedBlock q={quote} isOut={false} original={null} onJump={onJump} />);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    expect(onJump).toHaveBeenCalledOnce();
  });
});
