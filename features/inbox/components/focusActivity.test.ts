import { afterEach, describe, expect, it, vi } from 'vitest';
import { readLinkId } from '@/lib/supabase/utils';
import { activityForFocusDeal, isPlaceholderDealId, PLACEHOLDER_DEAL_PREFIX } from './focusActivity';

const contactId = '3f2b8c1e-5d4a-4c9b-9e7a-1b2c3d4e5f60';
const realDealId = 'a1b2c3d4-e5f6-8a7b-9c0d-1e2f3a4b5c6d';
const placeholderDealId = `${PLACEHOLDER_DEAL_PREFIX}${contactId}`;
const callLog = { type: 'CALL', title: 'Ligação', completed: true };

afterEach(() => vi.restoreAllMocks());

describe('registro feito no painel de contexto do modo Foco', () => {
  it('reconhece só o id do negócio fictício', () => {
    expect(isPlaceholderDealId(placeholderDealId)).toBe(true);
    expect(isPlaceholderDealId(realDealId)).toBe(false);
    expect(isPlaceholderDealId('')).toBe(false);
    expect(isPlaceholderDealId(undefined)).toBe(false);
    expect(isPlaceholderDealId(null)).toBe(false);
  });

  it('sai sem negócio quando o contato não tem lead e o negócio é o fictício', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const saved = activityForFocusDeal({ ...callLog, dealId: placeholderDealId });

    expect(saved).toEqual({ ...callLog, dealId: '' });
    // O id fictício seria recusado pelo serviço; o vazio é gravado como "sem negócio".
    expect(readLinkId(placeholderDealId)).toEqual({ ok: false });
    expect(readLinkId(saved.dealId)).toEqual({ ok: true, id: null });
  });

  it('mantém o negócio real como veio', () => {
    const activity = { ...callLog, dealId: realDealId };

    expect(activityForFocusDeal(activity)).toBe(activity);
  });

  it('não inventa negócio para o registro que não informa nenhum', () => {
    const note: { type: string; title: string; dealId?: string } = { type: 'NOTE', title: 'Nota' };

    expect(activityForFocusDeal(note)).toBe(note);
    expect(activityForFocusDeal(note)).not.toHaveProperty('dealId');
  });
});
