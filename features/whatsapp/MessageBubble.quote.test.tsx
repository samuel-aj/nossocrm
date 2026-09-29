import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { MessageBubble } from './DealWhatsAppChat';
import type { WaChatMessage } from './useWhatsAppChat';

it('uses the stored group author for a quoted message outside the loaded page', () => {
  render(<MessageBubble
    isGroup
    m={{
      id: 'reply',
      direction: 'in',
      body: 'Resposta',
      created_at: '2026-09-29T12:00:00Z',
      quoted: {
        provider_id: 'original',
        direction: 'in',
        sender_name: 'Participante Ana',
        body: 'Prévia armazenada',
        media_type: null,
      },
    } as WaChatMessage}
    quotedOriginal={null}
  />);
  expect(screen.getByText('Participante Ana')).toBeInTheDocument();
  expect(screen.getByText('Prévia armazenada')).toBeInTheDocument();
});
