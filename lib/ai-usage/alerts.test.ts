import { describe, expect, it } from 'vitest';
import { usageBlockDescription, usageBlockLabel, usageBlockResumeMessage } from './alerts';

describe('consumption pause explanations', () => {
  it.each(['usage_unknown', 'AI_USAGE_UNKNOWN', ' USAGE_UNKNOWN '])('explains %s as unconfirmed consumption, not an exhausted CRM limit', reason => {
    expect(usageBlockLabel(reason)).toBe('IA pausada: consumo pendente');
    expect(usageBlockDescription(reason)).toContain('O provedor não confirmou');
    expect(usageBlockDescription(reason)).toContain('mesmo havendo saldo');
    expect(usageBlockResumeMessage(reason)).toContain('revisar e liberar a pausa');
  });

  it('distinguishes provider credits from CRM quota in every shared label and instruction', () => {
    expect(usageBlockLabel('provider_insufficient_quota')).toBe('IA pausada: limite da API');
    expect(usageBlockDescription('provider_insufficient_quota')).toContain('aumentar o limite de tokens no CRM não resolve');
    expect(usageBlockResumeMessage('provider_insufficient_quota')).toContain('Regularize os créditos ou o limite da conta no provedor');
    expect(usageBlockResumeMessage('provider_insufficient_quota')).not.toContain('liberar saldo');
  });

  it.each(['conversation_token_limit', 'conversation_audio_limit', 'organization_daily_token_limit'])('keeps quota release instructions for %s', reason => {
    expect(usageBlockLabel(reason)).toBe('IA pausada por limite');
    expect(usageBlockResumeMessage(reason)).toContain('liberar saldo antes de retomar');
  });

  it('does not invent a limit or provider error when the persisted cause is unavailable', () => {
    expect(usageBlockLabel(null)).toBe('IA pausada por consumo');
    expect(usageBlockDescription('future_reason')).toContain('Não foi possível autorizar');
    expect(usageBlockResumeMessage(undefined)).toContain('revisar e liberar a pausa');
  });
});
