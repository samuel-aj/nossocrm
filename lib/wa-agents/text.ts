/**
 * Comparação de texto sem acento/caixa (palavras-chave dos gatilhos do agente
 * e das condições dos robôs).
 *
 * CLIENT-SAFE: só funções puras.
 */

// Marcas combinantes (acentos) U+0300..U+036F, montadas sem escapes para ficar legível
const COMBINING_MARKS_RE = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');

/** Minúsculas, sem acento, sem espaços extras (comparação de palavras-chave). */
export function normalizeKeyword(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_MARKS_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Primeira palavra-chave (como foi escrita) contida no texto, comparando normalizados; null se nenhuma. */
export function findKeyword(text: string, keywords: readonly string[]): string | null {
  const haystack = normalizeKeyword(text);
  if (!haystack) return null;
  for (const raw of keywords) {
    const kw = normalizeKeyword(raw);
    if (kw.length > 0 && haystack.includes(kw)) return raw;
  }
  return null;
}
