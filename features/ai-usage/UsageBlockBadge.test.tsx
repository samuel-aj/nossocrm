import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UsageBlockBadge } from './UsageBlockBadge';

describe('shared conversation and lead pause badge', () => {
  it.each(['badge', 'inline'] as const)('explains provider credits in the %s label and tooltip', variant => {
    render(<UsageBlockBadge variant={variant} block={{ conversationId: 'chat', blockedAt: '2026-11-16T17:08:00Z', reason: 'provider_insufficient_quota' }} />);
    expect(screen.getByText('IA pausada: limite da API')).toBeVisible();
    const badge = screen.getByTitle(/Regularize os créditos ou o limite da conta no provedor/);
    expect(badge.title).not.toContain('liberar saldo');
    expect(badge.title).toContain('Abrir o lead não remove este aviso');
  });
});
