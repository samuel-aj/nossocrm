import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { UsagePolicy } from '@/lib/ai-usage/types';

const h = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('./useAiUsage', () => ({
  useSaveUsagePolicy: () => ({ mutateAsync: h.save, isPending: false, error: null }),
}));
import { BudgetSettings } from './BudgetSettings';

const policy: UsagePolicy = {
  organization_id: 'test-organization',
  enabled: false,
  conversation_tokens: null,
  organization_daily_tokens: null,
  conversation_audio_seconds: null,
  timezone: 'America/Manaus',
  measurement_started_at: null,
  created_at: null,
  updated_at: null,
};

beforeEach(() => { h.save.mockReset().mockResolvedValue({}); });

describe('usage policy form', () => {
  it('enables a conversation-only limit without inventing daily or audio quotas', async () => {
    render(<BudgetSettings policy={policy} canEdit />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Limitar o atendimento automático' }));
    fireEvent.change(screen.getByLabelText('Tokens por conversa'), { target: { value: '300000' } });
    const daily = screen.getByLabelText('Tokens em 24h na organização') as HTMLInputElement;
    const audio = screen.getByLabelText('Áudio por conversa (segundos)') as HTMLInputElement;
    expect(daily.required).toBe(false);
    expect(audio.required).toBe(false);
    expect(daily.form?.checkValidity()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar regras' }));
    await waitFor(() => expect(h.save).toHaveBeenCalledExactlyOnceWith({
      enabled: true, conversation_tokens: 300000, organization_daily_tokens: null,
      conversation_audio_seconds: null, timezone: 'America/Manaus',
    }));
    expect(screen.getByRole('status').textContent).toBe('Regras salvas.');
  });

  it('still requires a conversation quota and validates optional quotas when filled', () => {
    render(<BudgetSettings policy={policy} canEdit />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Limitar o atendimento automático' }));
    const conversation = screen.getByLabelText('Tokens por conversa') as HTMLInputElement;
    expect(conversation.checkValidity()).toBe(false);
    fireEvent.change(conversation, { target: { value: '300000' } });
    const daily = screen.getByLabelText('Tokens em 24h na organização') as HTMLInputElement;
    fireEvent.change(daily, { target: { value: '0' } });
    expect(daily.form?.checkValidity()).toBe(false);
    fireEvent.change(daily, { target: { value: '900000' } });
    expect(daily.form?.checkValidity()).toBe(true);
    expect(h.save).not.toHaveBeenCalled();
  });
});
