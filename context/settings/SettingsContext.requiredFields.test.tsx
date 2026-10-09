import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SettingsProvider, useSettings } from './SettingsContext';
vi.mock('../AuthContext', () => ({ useAuth: () => ({ profile: null }) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/boards' }));
vi.mock('@/lib/supabase', () => ({ settingsService: {}, lifecycleStagesService: {}, productsService: {} }));
afterEach(() => vi.unstubAllGlobals());
it('rejects a blocked deletion so callers cannot announce success or clear lead values', async () => {
  const message = 'Remova a obrigatoriedade deste campo nas etapas antes de excluí-lo';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: message }) }));
  const { result } = renderHook(() => useSettings(), { wrapper: SettingsProvider });
  const cleanupValues = vi.fn();
  await act(async () => {
    await expect(result.current.removeCustomField('required-field').then(cleanupValues)).rejects.toThrow(message);
  });
  expect(cleanupValues).not.toHaveBeenCalled();
});
