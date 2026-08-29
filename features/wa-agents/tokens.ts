/**
 * Quebra do texto do roteiro em pedaços destacáveis: variáveis `{{...}}`,
 * marcadores de ação `[[acao:chave]]` e de mídia `[[midia:nome]]`.
 *
 * Usa os MESMOS padrões do servidor (VAR_PATTERN em lib/wa-agents/template.ts,
 * SCRIPT_*_MARKER_RE em lib/wa-agents/types.ts), então o que o editor pinta é
 * exatamente o que o agente vai substituir. Pedaço "desconhecido" = escrito no
 * texto mas sem variável/ação/mídia correspondente: some na hora de rodar.
 *
 * CLIENT-SAFE: só funções puras.
 */
import { VAR_PATTERN } from '@/lib/wa-agents/template';
import { normalizeKeyword } from '@/lib/wa-agents/text';
import { SCRIPT_ACTION_MARKER_RE, SCRIPT_MEDIA_MARKER_RE } from '@/lib/wa-agents/types';

export type TokenKind = 'var' | 'acao' | 'midia';

export type TokenPart =
  | { kind: 'text'; text: string }
  | { kind: TokenKind; text: string; name: string; known: boolean };

export type KnownTokens = {
  /** nomes das variáveis SEM as chaves duplas (ex.: 'nome_lead', 'negocio.titulo') */
  vars: string[];
  /** chaves das ações durante a conversa */
  actions: string[];
  /** nomes das mídias do agente */
  media: string[];
  /** false enquanto a lista de mídias não chegou: nenhum [[midia:...]] é acusado de inexistente */
  mediaLoaded?: boolean;
};

type Match = { start: number; end: number; kind: TokenKind; name: string };

function collect(text: string, source: string, flags: string, kind: TokenKind, out: Match[]): void {
  const rx = new RegExp(source, flags.includes('g') ? flags : `${flags}g`);
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length, kind, name: (m[1] ?? '').trim() });
    if (m[0].length === 0) rx.lastIndex++;
  }
}

/**
 * Divide `text` em pedaços de texto comum e tokens, em ordem. Sintaxes
 * diferentes não se sobrepõem na prática; se acontecer, vale o primeiro.
 */
export function splitPromptTokens(text: string, known: KnownTokens): TokenPart[] {
  if (!text) return [];
  const matches: Match[] = [];
  collect(text, VAR_PATTERN, 'g', 'var', matches);
  collect(text, SCRIPT_ACTION_MARKER_RE.source, SCRIPT_ACTION_MARKER_RE.flags, 'acao', matches);
  collect(text, SCRIPT_MEDIA_MARKER_RE.source, SCRIPT_MEDIA_MARKER_RE.flags, 'midia', matches);
  matches.sort((a, b) => a.start - b.start || b.end - a.end);

  // Variável casa pelo nome EXATO (o servidor resolve {{a.b}} por chave literal, com caixa);
  // ação e mídia casam sem acento/caixa, como findByName no servidor.
  const vars = new Set(known.vars.map(v => v.trim()));
  const actions = new Set(known.actions.map(a => normalizeKeyword(a)));
  const media = new Set(known.media.map(m => normalizeKeyword(m)));
  const midiasCarregadas = known.mediaLoaded !== false;

  const parts: TokenPart[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start < cursor) continue;
    if (m.start > cursor) parts.push({ kind: 'text', text: text.slice(cursor, m.start) });
    const conhecido =
      m.kind === 'var'
        ? vars.has(m.name)
        : m.kind === 'acao'
          ? actions.has(normalizeKeyword(m.name))
          : !midiasCarregadas || media.has(normalizeKeyword(m.name));
    parts.push({ kind: m.kind, text: text.slice(m.start, m.end), name: m.name, known: conhecido });
    cursor = m.end;
  }
  if (cursor < text.length) parts.push({ kind: 'text', text: text.slice(cursor) });
  return parts;
}

/** Tokens escritos no texto que não existem no CRM (variável, ação ou mídia inexistente). */
export function orphanTokens(text: string, known: KnownTokens): Array<{ kind: TokenKind; name: string; text: string }> {
  const seen = new Set<string>();
  const out: Array<{ kind: TokenKind; name: string; text: string }> = [];
  for (const p of splitPromptTokens(text, known)) {
    if (p.kind === 'text' || p.known) continue;
    // variável distingue caixa: {{Nome}} e {{nome}} são dois problemas diferentes
    const id = `${p.kind}:${p.kind === 'var' ? p.name : normalizeKeyword(p.name)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ kind: p.kind, name: p.name, text: p.text });
  }
  return out;
}

export const TOKEN_KIND_LABEL: Record<TokenKind, string> = {
  var: 'variável',
  acao: 'ação',
  midia: 'mídia',
};
