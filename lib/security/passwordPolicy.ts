import { z } from 'zod';

/**
 * Regra de senha do CRM (item "proteção contra senhas vazadas e política de
 * senha" da auditoria de segurança de 23/11/2026).
 *
 * Quem aplica de verdade é o Supabase Auth (painel > Authentication > Sign In /
 * Providers > Email): tamanho mínimo, caracteres obrigatórios e a recusa de
 * senha que já apareceu em vazamento (HaveIBeenPwned). A regra vale também para
 * senha definida pelo servidor (admin.createUser / updateUserById).
 *
 * Este arquivo espelha essa regra no CRM para a pessoa ver o problema antes de
 * enviar, e traduz a recusa do Supabase para português. Ao mudar a regra no
 * painel, ajuste as constantes daqui para as telas continuarem dizendo a verdade.
 */

export const PASSWORD_MIN_LENGTH = 8;
/** Teto do bcrypt usado pelo Supabase Auth. */
export const PASSWORD_MAX_LENGTH = 72;

export type PasswordRules = {
  minLength: boolean;
  hasLowercase: boolean;
  hasUppercase: boolean;
  hasDigit: boolean;
};

/** Rótulos da lista de requisitos, na ordem em que aparecem na tela. */
export const PASSWORD_RULE_LABELS: Array<{ key: keyof PasswordRules; label: string }> = [
  { key: 'minLength', label: `Mínimo ${PASSWORD_MIN_LENGTH} caracteres` },
  { key: 'hasLowercase', label: 'Letra minúscula' },
  { key: 'hasUppercase', label: 'Letra maiúscula' },
  { key: 'hasDigit', label: 'Número' },
];

export const PASSWORD_PLACEHOLDER = `Mínimo ${PASSWORD_MIN_LENGTH} caracteres`;
export const PASSWORD_HINT = `Pelo menos ${PASSWORD_MIN_LENGTH} caracteres, com letra maiúscula, letra minúscula e número.`;
export const PASSWORD_RULES_MESSAGE = `A senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres, com letra maiúscula, letra minúscula e número.`;
export const PASSWORD_LEAKED_MESSAGE =
  'Essa senha já apareceu em vazamentos de dados conhecidos e não pode ser usada. Escolha outra.';

const length = (password: string) => Array.from(password).length;

export function passwordRules(password: string): PasswordRules {
  const p = String(password ?? '');
  return {
    minLength: length(p) >= PASSWORD_MIN_LENGTH,
    hasLowercase: /[a-z]/.test(p),
    hasUppercase: /[A-Z]/.test(p),
    hasDigit: /[0-9]/.test(p),
  };
}

export function isPasswordValid(password: string): boolean {
  return validatePassword(password) === null;
}

/** Mensagem em português quando a senha não atende à regra; null quando atende. */
export function validatePassword(password: string): string | null {
  const p = String(password ?? '');
  if (length(p) > PASSWORD_MAX_LENGTH) return `A senha pode ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`;
  return Object.values(passwordRules(p)).every(Boolean) ? null : PASSWORD_RULES_MESSAGE;
}

/** Campo de senha para os schemas das rotas. */
export const zPassword = z.string().superRefine((value, ctx) => {
  const problem = validatePassword(value);
  if (problem) ctx.addIssue({ code: 'custom', message: problem });
});

const WEAK_MESSAGE = /Password (should be at least|should contain at least|is known to be weak|cannot be longer)/i;

/**
 * Traduz a recusa de senha do Supabase Auth. Devolve null quando o erro não é
 * de senha fraca (aí quem chamou segue com a mensagem normal).
 *
 * O Supabase informa os motivos em `reasons`: "length", "characters" e "pwned"
 * (senha que consta em vazamento).
 */
export function weakPasswordMessage(err: unknown): string | null {
  const e = (err && typeof err === 'object' ? err : {}) as {
    code?: unknown;
    name?: unknown;
    reasons?: unknown;
    message?: unknown;
  };
  const message = typeof err === 'string' ? err : typeof e.message === 'string' ? e.message : '';
  const reasons = Array.isArray(e.reasons) ? e.reasons.filter((r): r is string => typeof r === 'string') : [];

  const isWeak =
    e.code === 'weak_password' || e.name === 'AuthWeakPasswordError' || reasons.length > 0 || WEAK_MESSAGE.test(message);
  if (!isWeak) return null;

  if (/cannot be longer/i.test(message)) return `A senha pode ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`;

  const leaked = reasons.includes('pwned') || /is known to be weak/i.test(message);
  const rules =
    reasons.includes('length') || reasons.includes('characters') || /should be at least|should contain at least/i.test(message);

  if (leaked && !rules) return PASSWORD_LEAKED_MESSAGE;

  // O painel pode estar mais exigente que o CRM: usa o que o Supabase informou.
  const min = Number(/at least (\d+) characters/i.exec(message)?.[1]);
  const size = Number.isFinite(min) && min > PASSWORD_MIN_LENGTH ? min : PASSWORD_MIN_LENGTH;
  const symbols = message.includes('!@#') ? ', número e símbolo (por exemplo ! @ #)' : ' e número';
  const text = `A senha precisa ter pelo menos ${size} caracteres, com letra maiúscula, letra minúscula${symbols}.`;
  return leaked ? `${text} Ela também aparece em vazamentos de dados conhecidos; escolha outra.` : text;
}
