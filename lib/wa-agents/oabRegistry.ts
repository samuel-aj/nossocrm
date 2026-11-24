import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

export const OAB_STATES = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS',
  'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'] as const;

export const OabRegistrationSchema = z.object({
  professionalName: z.string().trim().min(2).max(120)
    .regex(/^[\p{L}\p{M}]+(?:[ '’-][\p{L}\p{M}]+)*$/u, 'Informe o nome do profissional.'),
  state: z.enum(OAB_STATES),
  number: z.string().trim().max(20)
    .regex(/^(?:[0-9]{1,7}|[0-9]{1,3}(?:\.[0-9]{3}){1,2})(?:[-/]?[a-z])?$/i, 'Informe o número da inscrição.')
    .transform(value => value.replace(/[.\-/]/g, '').toUpperCase())
    .pipe(z.string().regex(/^(?!0+[A-Z]?$)[0-9]{1,7}[A-Z]?$/, 'Número de inscrição inválido.')),
}).strict();

export type ConfirmedOabRegistration = z.infer<typeof OabRegistrationSchema>;
export type StoredOabRegistration = ConfirmedOabRegistration & { id: string };

/** Rows exist only after an explicit confirmation. A revoked registration is deleted. */
export async function loadConfirmedOabRegistrations(
  admin: SupabaseClient, organizationId: string,
): Promise<StoredOabRegistration[]> {
  const { data, error } = await admin.from('organization_oab_registrations')
    .select('id, professionalName:professional_name, state, number')
    .eq('organization_id', organizationId).order('professional_name').order('id');
  if (error) throw new Error('Não foi possível consultar as inscrições confirmadas da OAB.');
  return z.array(OabRegistrationSchema.extend({ id: z.string().uuid() })).parse(data);
}
