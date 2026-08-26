/**
 * Dados salvos pela ferramenta salvar_dados (wa_conversations.ai_state.dados).
 * O conteúdo vem do lead (via modelo) e volta ao prompt de sistema em todas
 * as rodadas, então é tratado como dado: chaves curtas em snake_case, valores
 * primitivos curtos, no máximo 30 chaves e 2 KB serializados, sem quebras de
 * linha nem o marcador [SEM_RESPOSTA].
 *
 * CLIENT-SAFE: só funções puras.
 */
import { normalizeKeyword } from './text';

export const NO_REPLY_TOKEN = '[SEM_RESPOSTA]';
export const SAVED_DATA_MAX_KEYS = 30;
export const SAVED_DATA_KEY_MAX_CHARS = 40;
export const SAVED_DATA_VALUE_MAX_CHARS = 200;
/** Tamanho máximo do JSON de dados salvos (caracteres). */
export const SAVED_DATA_MAX_CHARS = 2048;

export type SavedValue = string | number | boolean | null;

/** Caracteres de controle (inclui quebras de linha e tabulação). */
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/g;

/** Chave em snake_case ASCII (até 40 caracteres) ou '' quando não sobra nada. */
export function normalizeSavedKey(key: unknown): string {
  return normalizeKeyword(String(key ?? ''))
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, SAVED_DATA_KEY_MAX_CHARS);
}

/** Texto em uma linha, sem caracteres de controle nem o marcador de silêncio, até 200 caracteres. */
export function sanitizeSavedText(value: string): string {
  return value
    .split(NO_REPLY_TOKEN)
    .join('')
    .replace(CONTROL_CHARS_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SAVED_DATA_VALUE_MAX_CHARS)
    .trim();
}

/** Valor primitivo curto; undefined quando o valor deve ser descartado. */
export function sanitizeSavedValue(value: unknown): SavedValue | undefined {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return sanitizeSavedText(value);
  if (Array.isArray(value)) {
    const items = value
      .map(v => (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : ''))
      .filter(Boolean);
    return items.length > 0 ? sanitizeSavedText(items.join(', ')) : undefined;
  }
  return undefined;
}

/**
 * Objeto de dados saneado: chaves normalizadas, valores primitivos curtos,
 * no máximo 30 chaves (as mais recentes vencem) e 2 KB em JSON (as chaves
 * mais antigas saem primeiro).
 */
export function sanitizeSavedData(raw: unknown): Record<string, SavedValue> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, SavedValue> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = normalizeSavedKey(k);
    if (!key) continue;
    const value = sanitizeSavedValue(v);
    if (value === undefined) continue;
    // Chave repetida: sai da posição antiga e entra no fim (mais recente)
    delete out[key];
    out[key] = value;
  }
  let keys = Object.keys(out);
  if (keys.length > SAVED_DATA_MAX_KEYS) {
    for (const k of keys.slice(0, keys.length - SAVED_DATA_MAX_KEYS)) delete out[k];
    keys = Object.keys(out);
  }
  while (keys.length > 0 && JSON.stringify(out).length > SAVED_DATA_MAX_CHARS) {
    delete out[keys[0]];
    keys = Object.keys(out);
  }
  return out;
}

/** Mescla os dados novos aos já salvos (os novos prevalecem) e sanea o resultado. */
export function mergeSavedDataInto(
  current: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown> | null | undefined
): Record<string, SavedValue> {
  return sanitizeSavedData({ ...(current ?? {}), ...(incoming ?? {}) });
}
