import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/**
 * Regra do produto: padronizar telefones em E.164.
 *
 * - Aceita entrada “solta” (com espaços, parênteses, hífen etc.)
 * - Tenta normalizar usando `defaultCountry` quando não houver prefixo +
 * - Retorna string E.164 (ex.: +5511999990000) ou '' quando vazio
 *
 * Observação:
 * - Se a string já estiver em E.164 válido, retorna como está.
 * - Se não for possível parsear/validar, retorna uma versão “sanitizada”
 *   (mantendo + e dígitos) apenas se parecer E.164; caso contrário, retorna o input trimado.
 */
export function normalizePhoneE164(
  input?: string | null,
  opts?: {
    defaultCountry?: CountryCode;
  }
): string {
  const raw = (input ?? '').trim();
  if (!raw) return '';

  // Atalho: já está em E.164?
  const e164Candidate = raw.replace(/[\s\-()]/g, '');
  if (isE164(e164Candidate)) return e164Candidate;

  const defaultCountry = opts?.defaultCountry ?? 'BR';

  // Parse com fallback de país; funciona bem para inputs sem + (ex.: (11) 99999-0000)
  const phone = parsePhoneNumberFromString(raw, defaultCountry);
  if (phone?.isValid()) return phone.number; // E.164

  // Fallback: mantém somente + e dígitos. Se ficar com cara de E.164, retorna.
  const sanitized = raw.replace(/[^\d+]/g, '');
  if (isE164(sanitized)) return sanitized;

  // Último fallback: devolve o que o usuário tem (evita apagar dado), mas o objetivo
  // é que o sistema normalize na entrada e não chegue aqui com frequência.
  return raw;
}

/**
 * Função pública `isE164` do projeto.
 *
 * @param {string | null | undefined} input - Parâmetro `input`.
 * @returns {boolean} Retorna um valor do tipo `boolean`.
 */
export function isE164(input?: string | null): boolean {
  const value = (input ?? '').trim();
  return /^\+[1-9]\d{1,14}$/.test(value);
}

/**
 * Variantes equivalentes de um celular BR (nono dígito): o WhatsApp pode
 * devolver o JID SEM o 9 (+55 DD 9XXXXXXXX <-> +55 DD XXXXXXXX). Todo
 * casamento de telefone (conversa <-> contato) deve testar as duas formas.
 * Para números não-BR (ou fixos), devolve só o próprio número.
 */
export function brPhoneVariants(input?: string | null): string[] {
  const e164 = normalizePhoneE164(input);
  if (!e164) return [];
  const m = e164.match(/^\+55(\d{2})(\d{8,9})$/);
  if (!m) return [e164];
  const [, ddd, local] = m;
  // celular com 9: variante sem o 9 (JIDs antigos)
  if (local.length === 9 && local.startsWith('9') && /^[6-9]/.test(local[1])) {
    return [e164, `+55${ddd}${local.slice(1)}`];
  }
  // celular sem 9 (8 dígitos começando em 6-9): variante com o 9
  if (local.length === 8 && /^[6-9]/.test(local)) {
    return [e164, `+55${ddd}9${local}`];
  }
  return [e164];
}

/**
 * Para WhatsApp (wa.me) normalmente usamos somente dígitos (sem '+').
 * Retorna '' se não houver número.
 */
export function toWhatsAppPhone(input?: string | null, opts?: { defaultCountry?: CountryCode }): string {
  const e164 = normalizePhoneE164(input, opts);
  if (!e164) return '';
  return e164.replace(/^\+/, '');
}
