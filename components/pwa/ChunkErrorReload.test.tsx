import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import GlobalError from '@/app/global-error';
import { isStaleChunkError, tryAutoReload } from './ChunkErrorReload';
afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });
it('distinguishes ordinary errors from failed chunks', () => {
  expect(isStaleChunkError('Cannot read properties of undefined')).toBe(false);
  expect(isStaleChunkError('ChunkLoadError: Loading chunk 10 failed')).toBe(true);
  const html = renderToStaticMarkup(<GlobalError error={new Error('Cannot read properties of undefined')} />);
  expect(html).toContain('Não foi possível abrir esta tela');
  expect(html).not.toContain('CRM foi atualizado');
});
it('does not auto-reload if session storage cannot protect against a loop', () => {
  vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => { throw Error('unavailable'); });
  expect(tryAutoReload()).toBe(false);
});
it('stops another reload within the guard window', () => {
  sessionStorage.setItem('crm_chunk_reload_ts', String(Date.now()));
  expect(tryAutoReload()).toBe(false);
});
