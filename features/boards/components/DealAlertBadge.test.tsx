import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { DealAlertBadge } from './DealAlertBadge';
import type { DealAlert } from '@/types/types';

const alert: DealAlert = { id: 'one', message: 'Nova mensagem', bot_id: 'bot', run_id: 'run', block_id: 'block', created_at: '2026-10-23' };
it('uses green for an older alert and distinguishes a red attention alert by text and icon', () => {
  const view = render(<DealAlertBadge alert={alert} />);
  expect(screen.getByText('Aviso:')).toBeInTheDocument();
  expect(view.container.firstElementChild).toHaveClass('text-emerald-800');
  view.rerender(<DealAlertBadge alert={{ ...alert, tone: 'red' }} />);
  expect(screen.getByText('Atenção:')).toBeInTheDocument();
  expect(view.container.firstElementChild).toHaveClass('text-red-700');
  expect(screen.getByText('Nova mensagem')).toBeInTheDocument();
  view.rerender(<DealAlertBadge alert={null} />);
  expect(view.container).toBeEmptyDOMElement();
});
