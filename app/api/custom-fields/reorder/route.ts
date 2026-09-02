/**
 * PATCH /api/custom-fields/reorder { ids: string[] }
 * Grava a ordem manual dos campos (position = índice na lista). Só os ids
 * enviados mudam; campos da organização fora da lista ficam como estão.
 * Precisa da coluna custom_field_definitions.position (migração 20260902130000).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { withTabOrg } from '@/lib/supabase/tabOrgScope';

export const runtime = 'nodejs';

const Schema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).strict();

async function getAuthedAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' as const, status: 401 };
  const { data: profile, error } = await supabase.from('profiles').select('organization_id, role').eq('id', user.id).single();
  if (error || !profile?.organization_id) return { error: 'Profile not found' as const, status: 404 };
  const scoped = await withTabOrg({ id: user.id, role: profile.role, organization_id: profile.organization_id });
  if (!scoped) return { error: 'Acesso negado a esta organização' as const, status: 403 };
  if (scoped.role !== 'admin' && scoped.role !== 'super_admin') return { error: 'Forbidden' as const, status: 403 };
  return { organizationId: scoped.organization_id };
}

export async function PATCH(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const auth = await getAuthedAdmin();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 422 });
  const sb = createStaticAdminClient();
  for (const [index, id] of parsed.data.ids.entries()) {
    const { error } = await sb
      .from('custom_field_definitions')
      .update({ position: index })
      .eq('id', id)
      .eq('organization_id', auth.organizationId);
    if (error) {
      const pendente = /position/i.test(error.message) && /column|schema/i.test(error.message);
      return NextResponse.json(
        { error: pendente ? 'A ordem manual precisa da migração 20260902130000 no banco.' : error.message },
        { status: 500 }
      );
    }
  }
  return NextResponse.json({ ok: true });
}
