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

// Apaga uma sugestao: permitido ao proprio autor (na sua org) ou a um super_admin.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const auth = await getAuthedProfile();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.profile.role !== 'admin' && auth.profile.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await ctx.params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 422 });

  const sb = createStaticAdminClient();
  const { data: suggestion, error: findError } = await sb
    .from('suggestions')
    .select('id, author_id, organization_id')
    .eq('id', id)
    .maybeSingle();

  if (findError) return NextResponse.json({ error: findError.message }, { status: 500 });
  if (!suggestion) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const isSuperAdmin = auth.profile.role === 'super_admin';
  const isOwnerInOrg =
    suggestion.author_id === auth.profile.id &&
    suggestion.organization_id === auth.profile.organization_id;
  if (!isSuperAdmin && !isOwnerInOrg) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { error } = await sb.from('suggestions').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
