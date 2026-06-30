import { createStaticAdminClient } from '@/lib/supabase/server';
import { isValidUUID, sanitizeUUID } from '@/lib/supabase/utils';

export async function resolveBoardId(opts: { organizationId: string; boardKeyOrId: string }) {
  const sb = createStaticAdminClient();
  const value = opts.boardKeyOrId.trim();
  const query = sb
    .from('boards')
    .select('id')
    .eq('organization_id', opts.organizationId)
    .is('deleted_at', null)
    .match(isValidUUID(value) ? { id: value } : { key: value })
    .maybeSingle();

  const { data, error } = await query;
  if (error) throw error;
  const id = sanitizeUUID((data as any)?.id);
  return id || null;
}

export async function resolveBoardIdFromKey(opts: { organizationId: string; boardKey: string }) {
  return resolveBoardId({ organizationId: opts.organizationId, boardKeyOrId: opts.boardKey });
}

export async function resolveFirstStageId(opts: { organizationId: string; boardId: string }) {
  const sb = createStaticAdminClient();
  const { data, error } = await sb
    .from('board_stages')
    .select('id')
    .eq('organization_id', opts.organizationId)
    .eq('board_id', opts.boardId)
    .order('order', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return sanitizeUUID((data as any)?.id) || null;
}

/**
 * Resolve o RESPONSÁVEL (owner) de um deal. Aceita `ownerId` (UUID) ou
 * `ownerEmail`, e valida que o usuário pertence à organização.
 * - Nada enviado            -> { ok: true, ownerId: null } (não mexe)
 * - Inválido/não encontrado -> { ok: false, error }
 */
export async function resolveOwnerId(opts: {
  organizationId: string;
  ownerId?: string | null;
  ownerEmail?: string | null;
}): Promise<{ ok: true; ownerId: string | null } | { ok: false; error: string }> {
  const id = sanitizeUUID(opts.ownerId);
  const email = (opts.ownerEmail || '').trim();
  if (!id && !email) return { ok: true, ownerId: null };

  const sb = createStaticAdminClient();
  let query = sb.from('profiles').select('id').eq('organization_id', opts.organizationId).limit(1);
  query = id ? query.eq('id', id) : query.ilike('email', email);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) {
    return {
      ok: false,
      error: id ? 'owner_id não pertence a esta organização' : 'owner_email não encontrado nesta organização',
    };
  }
  return { ok: true, ownerId: (data as any).id as string };
}

