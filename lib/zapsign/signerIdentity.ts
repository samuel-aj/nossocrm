import { z } from 'zod';
import { isE164, normalizePhoneE164 } from '@/lib/phone';
import { normalizeVarName } from './variables';

export type SignerIdentity = { name: string; phone: string; email: string };
type SignerField = keyof SignerIdentity;

// A representative, witness or lawyer can have separate fields in the same template.
export function signerField(label: string, source?: string): SignerField | undefined {
  const key = normalizeVarName(label);
  if (/(?:representante|testemunha|advogad|escritorio|contratad[oa]|beneficiari[oa]|genitor|responsavel|curador|menor|(?:da|do)(?:mae|pai|filh[oa]))/.test(key)) return;
  if (/^(?:nome(?:completo)?|cliente|contratante|outorgante)(?:(?:do|da)?(?:cliente|contratante|signatario|outorgante|titular))?$/.test(key)) return 'name';
  if (/^(?:telefone|celular|whatsapp|fone)(?:(?:do|da)?(?:cliente|contratante|signatario|outorgante|titular))?$/.test(key)) return 'phone';
  if (/^email(?:(?:do|da)?(?:cliente|contratante|signatario|outorgante|titular|contato))?$/.test(key)) return 'email';
  if (source === 'contato.nome') return 'name';
  if (source === 'contato.telefone') return 'phone';
  if (source === 'contato.email') return 'email';
}

const emailAddress = z.string().email().max(254);

export function signerEmail(value: string) {
  const email = value.trim();
  if (!emailAddress.safeParse(email).success) return '';
  if (/^(?:sem(?:[._-]?(?:e[._-]?)?mail)?|nao[._-]?(?:tem|tenho|informado)|naopossui)@/iu.test(email)) return '';
  return email;
}

export function signerPhone(value: string) {
  if (!/^[+\d\s().-]+$/.test(value)) return '';
  const phone = normalizePhoneE164(value);
  return isE164(phone) && phone.length >= 9 ? phone : '';
}

export function fullSignerName(value: string) {
  return /^\p{L}[\p{L}\p{M}.'’ -]*\s+\p{L}[\p{L}\p{M}.'’ -]*$/u.test(value.trim());
}

export function identityFromForm(values: Record<string, string>, mapping: Record<string, string>, contact: SignerIdentity): SignerIdentity {
  const identity = { name: contact.name, phone: contact.phone, email: contact.email };
  for (const [label, value] of Object.entries(values)) {
    const field = signerField(label, mapping[label]);
    if (field) identity[field] = value;
  }
  return identity;
}
