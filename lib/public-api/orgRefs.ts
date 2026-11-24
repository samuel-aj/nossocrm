import { createStaticAdminClient } from '@/lib/supabase/server';

/**
 * A API pública grava com a chave de serviço (ignora RLS). Todo id de outra
 * tabela que vem no corpo precisa pertencer à organização da chave de API:
 * antes dava para ligar ao lead da org A um contato ou empresa da org B
 * (auditoria de 23/11/2026).
 */
export async function refBelongsToOrg(
  table: 'contacts' | 'crm_companies',
  id: string,
  organizationId: string,
): Promise<boolean> {
  const { data, error } = await createStaticAdminClient()
    .from(table)
    .select('id')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/**
 * Valor entre aspas para filtros `.or()` do PostgREST: vírgula, ponto e
 * parênteses do texto não viram filtro novo.
 */
export function quotePostgrestValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
