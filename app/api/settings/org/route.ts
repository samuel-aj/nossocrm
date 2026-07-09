import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';

export const runtime = 'nodejs';

/**
 * Preferências da ORGANIZAÇÃO (não-IA). Hoje: etapa "Inativos" (opcional).
 * GET: qualquer membro logado lê. PATCH: só admin/super_admin altera.
 */

async function getAuthedProfile() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' as const, status: 401 };
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();
  if (error || !profile?.organization_id) {
    return { error: 'Profile not found' as const, status: 404 };
  }
  return { profile };
}

function isAdmin(role: string | null | undefined) {
  return role === 'admin' || role === 'super_admin';
}

export async function GET() {
  const auth = await getAuthedProfile();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sb = createStaticAdminClient();
  const { data, error } = await sb
    .from('organization_settings')
    .select('inactive_leads_enabled')
    .eq('organization_id', auth.profile.organization_id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ inactive_leads_enabled: !!data?.inactive_leads_enabled });
}

const PatchSchema = z.object({
  inactive_leads_enabled: z.boolean(),
}).strict();

export async function PATCH(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const auth = await getAuthedProfile();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!isAdmin(auth.profile.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 422 });
  }

  const sb = createStaticAdminClient();
  const { error } = await sb
    .from('organization_settings')
    .upsert(
      {
        organization_id: auth.profile.organization_id,
        inactive_leads_enabled: parsed.data.inactive_leads_enabled,
      },
      { onConflict: 'organization_id' }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ inactive_leads_enabled: parsed.data.inactive_leads_enabled });
}
