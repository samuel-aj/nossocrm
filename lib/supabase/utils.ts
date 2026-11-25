/**
 * @fileoverview Utilitários de sanitização e validação para Supabase.
 * 
 * Este módulo fornece funções para validar e sanitizar dados antes
 * de enviar ao Supabase, prevenindo erros de FK e garantindo integridade.
 * 
 * ## Conceitos Multi-Tenant
 * 
 * - **organization_id**: ID do tenant (quem paga pelo SaaS) - vem do auth/profile
 * - **client_company_id**: Empresa do cliente cadastrada no CRM - relacionamento de negócio
 * 
 * ## Regra de Ouro
 * 
 * Todos os UUIDs devem ser válidos ou NULL - nunca string vazia!
 * 
 * @module lib/supabase/utils
 * 
 * @example
 * ```typescript
 * import { sanitizeUUID, requireUUID, sanitizeText } from '@/lib/supabase/utils';
 * 
 * // Campo opcional - retorna null se inválido
 * const contactId = sanitizeUUID(form.contactId);
 * 
 * // Campo obrigatório - lança erro se inválido
 * const boardId = requireUUID(form.boardId, 'Board ID');
 * ```
 */

import { OrganizationId, ClientCompanyId } from '@/types';
import { supabase } from './client';

/**
 * Expressão regular para validação de UUID (RFC 9562, versões 1 a 8).
 *
 * O banco gera v4, mas o lead automático do WhatsApp cria contatos e negócios
 * com id determinístico versão 8 (lib/wa-agents/autoLead.ts). Restringir a
 * versão aqui faz o próprio CRM recusar registros que existem no banco.
 * @constant
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Verifica se um valor é um UUID válido.
 * 
 * @param value - Valor a ser verificado.
 * @returns true se for um UUID válido, false caso contrário.
 * 
 * @example
 * ```typescript
 * isValidUUID('123e4567-e89b-12d3-a456-426614174000') // true
 * isValidUUID('') // false
 * isValidUUID('abc') // false
 * ```
 */
export function isValidUUID(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!value || value.trim() === '') return false;
  return UUID_REGEX.test(value);
}

/**
 * Sanitiza um campo UUID - retorna null se inválido.
 * 
 * Use para TODOS os campos FK opcionais. Previne erros de
 * constraint violation quando o usuário não preenche um campo.
 * Exceção: vínculo que não pode sumir em silêncio (negócio, contato) usa `readLinkId`.
 *
 * @param value - UUID a ser sanitizado.
 * @returns UUID válido ou null.
 * 
 * @example
 * ```typescript
 * sanitizeUUID('123e4567-e89b-12d3-a456-426614174000') // '123e4567-...'
 * sanitizeUUID('') // null
 * sanitizeUUID(undefined) // null
 * sanitizeUUID('invalid') // null (com warning no console)
 * ```
 */
export function sanitizeUUID(value: string | undefined | null): string | null {
  if (!value || value === '' || value.trim() === '') return null;
  if (!isValidUUID(value)) {
    console.warn(`[sanitizeUUID] UUID inválido descartado: "${value}"`);
    return null;
  }
  return value;
}

/**
 * Sanitiza múltiplos campos UUID de um objeto.
 * 
 * Útil para processar formulários com vários campos UUID de uma vez.
 * 
 * @param obj - Objeto contendo os campos.
 * @param uuidFields - Lista de campos a serem sanitizados.
 * @returns Novo objeto com campos sanitizados.
 * 
 * @example
 * ```typescript
 * const form = { contactId: '', boardId: 'valid-uuid', name: 'Test' };
 * const sanitized = sanitizeUUIDs(form, ['contactId', 'boardId']);
 * // { contactId: null, boardId: 'valid-uuid', name: 'Test' }
 * ```
 */
export function sanitizeUUIDs<T extends Record<string, unknown>>(
  obj: T,
  uuidFields: (keyof T)[]
): T {
  const result = { ...obj };
  for (const field of uuidFields) {
    const value = obj[field];
    if (value !== undefined) {
      (result as Record<string, unknown>)[field as string] = sanitizeUUID(value as string);
    }
  }
  return result;
}

/**
 * Valida que um UUID existe e é válido, lançando erro se não for.
 * 
 * Use para campos OBRIGATÓRIOS como board_id em deals.
 * 
 * @param value - UUID a ser validado.
 * @param fieldName - Nome do campo para mensagem de erro.
 * @returns UUID válido.
 * @throws Error se o UUID for inválido ou vazio.
 * 
 * @example
 * ```typescript
 * const boardId = requireUUID(form.boardId, 'Board ID');
 * // Retorna UUID válido ou lança erro
 * ```
 */
export function requireUUID(value: string | undefined | null, fieldName: string): string {
  const sanitized = sanitizeUUID(value);
  if (!sanitized) {
    throw new Error(`${fieldName} é obrigatório e deve ser um UUID válido`);
  }
  return sanitized;
}

/**
 * Formato em que o banco devolve uma coluna uuid: 8-4-4-4-12 em hexadecimal.
 * Não olha versão nem variante, de propósito (ver `readLinkId`).
 * @constant
 */
const UUID_SHAPE_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resultado de `readLinkId`: o id pronto para gravar (null quando não há vínculo) ou a recusa. */
export type LinkIdResult = { ok: true; id: string | null } | { ok: false };

/**
 * Textos de tela para a recusa de `readLinkId`. Vários chamadores mostram a
 * mensagem do serviço como veio, e o caso real é o registro ainda sendo salvo.
 */
export const UNREADABLE_DEAL_MESSAGE = 'Não foi possível identificar o lead. Aguarde alguns segundos e tente novamente.';
export const UNREADABLE_CONTACT_MESSAGE = 'Não foi possível identificar o contato. Aguarde alguns segundos e tente novamente.';

/**
 * Lê o id de um vínculo (negócio, contato) que vai ser gravado.
 *
 * - vazio ('', só espaços, null, undefined): sem vínculo, `id: null`;
 * - texto com formato de UUID: segue como veio, e quem diz se o registro existe é o banco;
 * - qualquer outra coisa (id provisório `temp-...`, marcador, texto solto): recusado.
 *
 * Use no lugar de `sanitizeUUID` quando trocar um valor preenchido por null
 * gravaria o registro sem o vínculo, em silêncio. A versão do UUID não é
 * conferida: um id que veio do banco nunca pode ser recusado pela tela.
 * A recusa deixa um aviso no console, porque nem todo chamador olha o erro.
 *
 * Onde não serve:
 * - gravação com chave de serviço (rotas, API pública): sem as regras de acesso
 *   do usuário, "o banco decide" não protege o registro de outra organização;
 * - id obrigatório: vazio devolve `id: null`, e quem recusa o null é o banco.
 *
 * @param value - Id do vínculo, como veio do chamador.
 * @returns `{ ok: true, id }` para gravar ou `{ ok: false }` para devolver erro.
 *
 * @example
 * ```typescript
 * const deal = readLinkId(activity.dealId);
 * if (!deal.ok) return { data: null, error: new Error(UNREADABLE_DEAL_MESSAGE) };
 * insert({ deal_id: deal.id });
 * ```
 */
export function readLinkId(value: unknown): LinkIdResult {
  if (value === undefined || value === null) return { ok: true, id: null };
  if (typeof value === 'string') {
    if (value.trim() === '') return { ok: true, id: null };
    if (UUID_SHAPE_REGEX.test(value)) return { ok: true, id: value };
  }
  // Só texto vai para o aviso: converter um valor qualquer pode lançar.
  const shown = typeof value === 'string' ? `"${value}"` : typeof value;
  console.warn(`[readLinkId] id de vínculo recusado: ${shown}`);
  return { ok: false };
}

/**
 * @deprecated Single-tenant migration. Use string directly if needed, but organization_id is no longer used for filtering.
 */
export function sanitizeOrganizationId(value: string | undefined | null): OrganizationId | null {
  return sanitizeUUID(value) as OrganizationId | null;
}

/**
 * @deprecated Single-tenant migration. Authentication is handled by RLS via auth.uid().
 */
export const getCurrentUserOrganizationId = async (): Promise<string | null> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  // Return a dummy value or null as strictly single-tenant doesn't need this
  return null;
};

/**
 * @deprecated Single-tenant migration. Do not use.
 */
export function requireOrganizationId(value: string | undefined | null): OrganizationId {
  // Just return empty string or whatever satisfies the type if strictly needed, or throw if we want to catch usage
  // But to avoid breaking legacy code that might still call it:
  return (sanitizeUUID(value) || '') as OrganizationId;
}

/**
 * Sanitiza client_company_id (empresa CRM do cliente).
 * 
 * Alias semântico para empresas cadastradas no CRM.
 * 
 * @param value - Client company ID a ser sanitizado.
 * @returns ClientCompanyId válido ou null.
 */
export function sanitizeClientCompanyId(value: string | undefined | null): ClientCompanyId | null {
  return sanitizeUUID(value) as ClientCompanyId | null;
}

/**
 * Sanitiza string de texto - retorna null se vazio.
 * 
 * @param value - Texto a ser sanitizado.
 * @returns Texto trimado ou null.
 * 
 * @example
 * ```typescript
 * sanitizeText('  hello  ') // 'hello'
 * sanitizeText('   ') // null
 * sanitizeText('') // null
 * ```
 */
export function sanitizeText(value: string | undefined | null): string | null {
  if (!value || value.trim() === '') return null;
  return value.trim();
}

/**
 * Sanitiza número - retorna valor default se inválido.
 * 
 * @param value - Valor a ser convertido.
 * @param defaultValue - Valor padrão se inválido (default: 0).
 * @returns Número válido ou valor padrão.
 * 
 * @example
 * ```typescript
 * sanitizeNumber(42) // 42
 * sanitizeNumber('42') // 42
 * sanitizeNumber('abc') // 0
 * sanitizeNumber(NaN, 100) // 100
 * ```
 */
export function sanitizeNumber(value: unknown, defaultValue = 0): number {
  if (typeof value === 'number' && !isNaN(value)) return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (!isNaN(parsed)) return parsed;
  }
  return defaultValue;
}
