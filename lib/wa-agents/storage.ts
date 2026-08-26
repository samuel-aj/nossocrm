/**
 * Consulta de objetos no bucket privado wa-agent-files: tamanho e tipo reais
 * do arquivo enviado (os valores do corpo da requisição não são confiáveis).
 * SERVER.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { errorMessage } from './errors';
import { normalizeMime, WA_AGENT_FILES_BUCKET } from './types';

export type StoredFileInfo = { size: number | null; mime: string | null };

/** Tipos genéricos que o navegador manda quando não reconhece o arquivo. */
const GENERIC_MIMES = new Set(['application/octet-stream', 'binary/octet-stream', 'text/plain']);

/** true quando o mime do Storage não diz nada sobre o conteúdo. */
export function isGenericMime(mime: string | null | undefined): boolean {
  const m = normalizeMime(mime);
  return !m || GENERIC_MIMES.has(m);
}

/**
 * Tamanho e mime do objeto no bucket wa-agent-files; null quando o objeto
 * não existe (ou o Storage não respondeu). Tenta `info` e, como reserva,
 * `list` na pasta.
 */
export async function getAgentFileInfo(admin: SupabaseClient, path: string): Promise<StoredFileInfo | null> {
  if (!path) return null;
  try {
    const { data, error } = await admin.storage.from(WA_AGENT_FILES_BUCKET).info(path);
    if (!error && data) {
      return {
        size: typeof data.size === 'number' ? data.size : null,
        mime: normalizeMime(data.contentType) || null,
      };
    }
  } catch (e) {
    console.error('[wa-agents] info do arquivo falhou:', errorMessage(e));
  }
  try {
    const slash = path.lastIndexOf('/');
    const folder = slash >= 0 ? path.slice(0, slash) : '';
    const name = slash >= 0 ? path.slice(slash + 1) : path;
    const { data, error } = await admin.storage.from(WA_AGENT_FILES_BUCKET).list(folder, { search: name, limit: 100 });
    if (error || !data) return null;
    const found = data.find(o => o.name === name);
    if (!found) return null;
    const meta = (found.metadata ?? {}) as { size?: unknown; mimetype?: unknown };
    return {
      size: typeof meta.size === 'number' ? meta.size : null,
      mime: normalizeMime(typeof meta.mimetype === 'string' ? meta.mimetype : null) || null,
    };
  } catch (e) {
    console.error('[wa-agents] listar arquivo falhou:', errorMessage(e));
    return null;
  }
}
