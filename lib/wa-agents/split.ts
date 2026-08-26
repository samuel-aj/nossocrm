/**
 * Divide a resposta do modelo em mensagens do WhatsApp: cada quebra de linha
 * vira uma mensagem separada.
 */

export const MAX_LINES = 8;

// Montado por string para não depender do alvo ES2018 do TypeScript (\p{...} com flag u)
const ONLY_SYMBOLS_RE = new RegExp(
  '^[\\p{P}\\p{S}\\p{Extended_Pictographic}\\p{Emoji_Modifier}\\p{M}\\s\\u200d\\ufe0f]+$',
  'u'
);

/** true quando a linha é só pontuação/emoji (sem letras nem números). */
export function isOnlySymbols(line: string): boolean {
  return line.length > 0 && ONLY_SYMBOLS_RE.test(line);
}

/**
 * Normaliza \r\n, divide por \n, remove espaços e linhas vazias, junta linhas
 * só de pontuação/emoji com a anterior e limita a MAX_LINES (o excedente é
 * concatenado na última).
 */
export function splitLines(text: string): string[] {
  if (!text) return [];
  const raw = text.replace(/\r\n?/g, '\n').split('\n');
  const lines: string[] = [];
  for (const piece of raw) {
    const line = piece.trim();
    if (!line) continue;
    if (lines.length > 0 && isOnlySymbols(line)) {
      lines[lines.length - 1] = `${lines[lines.length - 1]} ${line}`;
      continue;
    }
    lines.push(line);
  }
  if (lines.length <= MAX_LINES) return lines;
  const head = lines.slice(0, MAX_LINES - 1);
  const tail = lines.slice(MAX_LINES - 1).join('\n');
  return [...head, tail];
}
