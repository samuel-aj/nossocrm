import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';

export const runtime = 'nodejs';

// Grupos de campos personalizados como entidade própria (custom_field_groups):
// permite criar/excluir grupos sem depender de um campo. O vínculo campo→grupo
// continua sendo custom_field_definitions.group_name (por nome).
const CreateSchema = z.object({
  name: z.string().min(1).max(60),
}).strict();

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
    .from('custom_field_groups')
    .select('name')
    .eq('organization_id', auth.profile.organization_id)
    .order('name', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: (data || []).map(r => r.name as string) });
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const auth = await getAuthedProfile();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!isAdmin(auth.profile.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 422 });
  }
  const name = parsed.data.name.trim();
  if (!name) return NextResponse.json({ error: 'Invalid payload' }, { status: 422 });

  const sb = createStaticAdminClient();
  const { data, error } = await sb
    .from('custom_field_groups')
    .insert({ organization_id: auth.profile.organization_id, name })
    .select('name')
    .single();

  if (error) {
    const msg = (error as any).message || 'Insert failed';
    const isDup = /duplicate key|unique/i.test(msg);
    return NextResponse.json({ error: isDup ? 'Já existe um grupo com esse nome' : msg }, { status: isDup ? 409 : 500 });
  }
  return NextResponse.json({ data: { name: data.name as string } }, { status: 201 });
}

export async function DELETE(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const auth = await getAuthedProfile();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!isAdmin(auth.profile.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const name = (new URL(req.url).searchParams.get('name') || '').trim();
  if (!name || name.length > 60) return NextResponse.json({ error: 'Invalid name' }, { status: 422 });

  const sb = createStaticAdminClient();

  // Campos do grupo voltam para "sem grupo" (nunca são apagados junto)
  const { error: ungroupError } = await sb
    .from('custom_field_definitions')
    .update({ group_name: null })
    .eq('organization_id', auth.profile.organization_id)
    .eq('group_name', name);
  if (ungroupError) return NextResponse.json({ error: ungroupError.message }, { status: 500 });

  const { error, count } = await sb
    .from('custom_field_groups')
    .delete({ count: 'exact' })
    .eq('organization_id', auth.profile.organization_id)
    .eq('name', name);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
