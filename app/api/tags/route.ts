import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { withTabOrg } from '@/lib/supabase/tabOrgScope';

export const runtime = 'nodejs';

const CreateSchema = z.object({
  name: z.string().min(1).max(80),
  color: z.string().min(1).max(40).optional(),
}).strict();

const BulkImportSchema = z.object({
  items: z.array(CreateSchema).max(500),
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
  // ORG POR ABA: honra o header x-org-id validado (ver lib/supabase/tabOrgScope)
  const scoped = await withTabOrg({ id: user.id, role: profile.role, organization_id: profile.organization_id });
  if (!scoped) return { error: 'Acesso negado a esta organização' as const, status: 403 };
  return { profile: { ...profile, organization_id: scoped.organization_id, role: scoped.role } };
}

export async function GET() {
  const auth = await getAuthedProfile();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sb = createStaticAdminClient();
  const { data, error } = await sb
    .from('tags')
    .select('id,name,color,created_at')
    .eq('organization_id', auth.profile.organization_id)
    .order('name', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data || [] });
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const auth = await getAuthedProfile();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => null);

  // Bulk import path (migration from localStorage)
  if (body && typeof body === 'object' && Array.isArray((body as any).items)) {
    const parsed = BulkImportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 422 });
    }
    if (parsed.data.items.length === 0) return NextResponse.json({ data: [] });

    const sb = createStaticAdminClient();
    const rows = parsed.data.items.map(it => ({
      organization_id: auth.profile.organization_id,
      name: it.name,
      color: it.color ?? 'bg-gray-500',
    }));
    const { data, error } = await sb
      .from('tags')
      .upsert(rows, { onConflict: 'name,organization_id', ignoreDuplicates: true })
      .select('id,name,color,created_at');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data: data || [] });
  }

  // Single-item create
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 422 });
  }

  const sb = createStaticAdminClient();
  const { data, error } = await sb
    .from('tags')
    .insert({
      organization_id: auth.profile.organization_id,
      name: parsed.data.name,
      color: parsed.data.color ?? 'bg-gray-500',
    })
    .select('id,name,color,created_at')
    .single();

  if (error) {
    const msg = (error as any).message || 'Insert failed';
    const isDup = /duplicate key|unique/i.test(msg);
    return NextResponse.json({ error: isDup ? 'Tag já existe' : msg }, { status: isDup ? 409 : 500 });
  }
  return NextResponse.json({ data }, { status: 201 });
}
