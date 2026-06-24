import { NextResponse } from 'next/server';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { isValidUUID } from '@/lib/supabase/utils';

export const runtime = 'nodejs';

async function getAuthedProfile() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' as const, status: 401 };
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, organization_id, role')
    .eq('id', user.id)
    .single();
  if (error || !profile?.organization_id) {
    return { error: 'Profile not found' as const, status: 404 };
  }
  return { profile };
}

/** Confirma que a sugestao existe e e visivel para o usuario (mesma org, ou super_admin). */
async function assertVisibleSuggestion(
  sb: ReturnType<typeof createStaticAdminClient>,
  id: string,
  profile: { organization_id: string; role: string },
) {
  const { data, error } = await sb
    .from('suggestions')
    .select('id, organization_id')
    .eq('id', id)
    .maybeSingle();
  if (error) return { ok: false as const, status: 500, error: error.message };
  if (!data) return { ok: false as const, status: 404, error: 'Not found' };
  if (profile.role !== 'super_admin' && data.organization_id !== profile.organization_id) {
    return { ok: false as const, status: 404, error: 'Not found' };
  }
  return { ok: true as const };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const auth = await getAuthedProfile();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await ctx.params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 422 });

  const sb = createStaticAdminClient();
  const visible = await assertVisibleSuggestion(sb, id, auth.profile);
  if (!visible.ok) return NextResponse.json({ error: visible.error }, { status: visible.status });

  const { error } = await sb
    .from('suggestion_votes')
    .insert({ suggestion_id: id, user_id: auth.profile.id });

  if (error) {
    // Voto duplicado e idempotente: o usuario ja votou.
    if (/duplicate key|unique/i.test(error.message)) return NextResponse.json({ ok: true });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const auth = await getAuthedProfile();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await ctx.params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 422 });

  const sb = createStaticAdminClient();
  const { error } = await sb
    .from('suggestion_votes')
    .delete()
    .eq('suggestion_id', id)
    .eq('user_id', auth.profile.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
