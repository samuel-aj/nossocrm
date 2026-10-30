/**
 * Mensagem que o CRM manda no WhatsApp com o link de assinatura: variáveis
 * disponíveis, tokenização para a prévia na tela e a garantia de que o link
 * sempre vai (sem {{link}} na mensagem, ele entra no final).
 *
 * Módulo puro: usado no servidor (envio) e no navegador (prévia).
 */
import { VAR_PATTERN } from '@/lib/wa-agents/template';

export const DEFAULT_SIGN_MESSAGE = 'Olá {{primeiro_nome}}, segue o documento "{{documento}}" para assinatura eletrônica: {{link}}';

export type SignMessageVar = { key: string; label: string; description: string };

/** Variáveis que a mensagem aceita (chaves resolvidas em sendLinkViaCrm). */
export const SIGN_MESSAGE_VARS: SignMessageVar[] = [
  { key: 'primeiro_nome', label: 'Primeiro nome', description: 'Primeiro nome do cliente' },
  { key: 'nome', label: 'Nome completo', description: 'Nome completo do cliente' },
  { key: 'documento', label: 'Nome do documento', description: 'Nome do documento como aparece na ZapSign' },
  { key: 'link', label: 'Link de assinatura', description: 'Link para o cliente abrir e assinar' },
  { key: 'negocio.titulo', label: 'Título do lead', description: 'Título do lead no CRM' },
];

const KNOWN = new Set(SIGN_MESSAGE_VARS.map((v) => v.key));
const LINK_RE = /\{\{\s*link\s*\}\}/;

export const signVarToken = (key: string) => `{{${key}}}`;

export function hasSignLink(message: string): boolean {
  return LINK_RE.test(message);
}

/** Sem {{link}} no texto, o link vai numa linha ao final (o cliente precisa dele para assinar). */
export function ensureSignLink(message: string): string {
  const text = message.trim();
  if (!text) return DEFAULT_SIGN_MESSAGE;
  return hasSignLink(text) ? text : `${text}\n\n{{link}}`;
}

export type SignMessagePart = { kind: 'text'; text: string } | { kind: 'var'; name: string; known: boolean };

/** Quebra a mensagem em texto e variáveis, para a prévia destacar cada uma. */
export function splitSignMessage(message: string): SignMessagePart[] {
  const re = new RegExp(VAR_PATTERN, 'g');
  const parts: SignMessagePart[] = [];
  let last = 0;
  for (const m of message.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ kind: 'text', text: message.slice(last, at) });
    const name = (m[1] ?? '').trim();
    parts.push({ kind: 'var', name, known: KNOWN.has(name) });
    last = at + m[0].length;
  }
  if (last < message.length) parts.push({ kind: 'text', text: message.slice(last) });
  return parts;
}

/** Insere um token no texto respeitando a seleção, com espaço antes/depois quando preciso. */
export function insertSignToken(value: string, token: string, start: number, end: number = start): { next: string; caret: number } {
  const s = Math.max(0, Math.min(start, value.length));
  const e = Math.max(s, Math.min(end, value.length));
  const before = value.slice(0, s);
  const after = value.slice(e);
  const needBefore = before.length > 0 && !/\s$/.test(before);
  // pontuação logo depois ("{{nome}}!") não ganha espaço
  const needAfter = after.length > 0 && !/^[\s.,;:!?)\]]/.test(after);
  const inserted = `${needBefore ? ' ' : ''}${token}${needAfter ? ' ' : ''}`;
  return { next: before + inserted + after, caret: s + inserted.length };
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';
