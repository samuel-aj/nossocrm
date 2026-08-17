'use client';

import { useEffect } from 'react';

/**
 * Recuperação automática de "chunk antigo": após um deploy, uma aba aberta
 * antes dele referencia arquivos JS que não existem mais no servidor; ao
 * navegar pra uma tela ainda não carregada, o import dinâmico falha e o app
 * quebrava com "Application error: a client-side exception...". Aqui a falha
 * é detectada e a aba recarrega sozinha pra versão nova.
 */

const CHUNK_ERROR_RE =
  /Loading chunk|ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

const GUARD_KEY = 'crm_chunk_reload_ts';
const GUARD_WINDOW_MS = 60_000;

/** true quando é um erro de chunk desatualizado (deploy no meio do caminho). */
export function isStaleChunkError(message: string | null | undefined): boolean {
  return !!message && CHUNK_ERROR_RE.test(message);
}

/** Permite UM reload automático por minuto — evita loop se o reload não resolver. */
export function tryAutoReload(): boolean {
  try {
    const last = Number(sessionStorage.getItem(GUARD_KEY) || 0);
    if (Date.now() - last < GUARD_WINDOW_MS) return false;
    sessionStorage.setItem(GUARD_KEY, String(Date.now()));
  } catch {
    // sessionStorage indisponível: recarrega mesmo assim (pior caso, uma vez)
  }
  window.location.reload();
  return true;
}

export function ChunkErrorReload() {
  useEffect(() => {
    const onError = (ev: ErrorEvent) => {
      if (isStaleChunkError(ev.message)) tryAutoReload();
    };
    const onRejection = (ev: PromiseRejectionEvent) => {
      const reason = ev.reason as { message?: string } | string | null;
      const msg = typeof reason === 'string' ? reason : reason?.message;
      if (isStaleChunkError(msg)) tryAutoReload();
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
