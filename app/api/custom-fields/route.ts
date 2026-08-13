import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { withTabOrg } from '@/lib/supabase/tabOrgScope';

export const runtime = 'nodejs';

const FieldTypeEnum = z.enum(['text', 'number', 'date', 'select', 'multiselect', 'currency']);

const CreateSchema = z.object({
  key: z.string().min(1).max(80).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'key must be camelCase'),
  label: z.string().min(1).max(120),
  type: FieldTypeEnum,
  options: z.array(z.string()).optional(),
  entity_type: z.string().min(1).max(40).optional(),
  group_name: z.string().min(1).max(60).nullable().optional(),
}).strict();

// Bulk import: used by the frontend to migrate localStorage-based definitions
// on first load after the Supabase-backed storage rollout. Each item is upserted
// by (key, organization_id) so the migration is idempotent and safe to re-run.
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

function isAdmin(role: string | null | undefined) {
  return role === 'admin' || role === 'super_admin';
}

function mapRow(row: any) {
  return {
    id: row.id as string,
    key: row.key as string,
    label: row.label as string,
    type: row.type as z.infer<typeof FieldTypeEnum>,
    options: Array.isArray(row.options) ? (row.options as string[]) : undefined,
    entity_type: (row.entity_type ?? 'deal') as string,
    group_name: (row.group_name ?? null) as string | null,
    created_at: row.created_at as string | null,
  };
}

export async function GET() {
  const auth = await getAuthedProfile();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sb = createStaticAdminClient();
  const { data, error } = await sb
    .from('custom_field_definitions')
    .select('id,key,label,type,options,entity_type,group_name,created_at')
    .eq('organization_id', auth.profile.organization_id)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: (data || []).map(mapRow) });
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const auth = await getAuthedProfile();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!isAdmin(auth.profile.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

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
      key: it.key,
      label: it.label,
      type: it.type,
      options: (it.type === 'select' || it.type === 'multiselect') ? (it.options ?? []) : null,
      entity_type: it.entity_type ?? 'deal',
      group_name: it.group_name ?? null,
    }));
    const { data, error } = await sb
      .from('custom_field_definitions')
      .upsert(rows, { onConflict: 'key,organization_id', ignoreDuplicates: false })
      .select('id,key,label,type,options,entity_type,group_name,created_at');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data: (data || []).map(mapRow) });
  }

  // Single-item create
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 422 });
  }

  const sb = createStaticAdminClient();
  const insertPayload: any = {
    organization_id: auth.profile.organization_id,
    key: parsed.data.key,
    label: parsed.data.label,
    type: parsed.data.type,
    options: (parsed.data.type === 'select' || parsed.data.type === 'multiselect')
      ? (parsed.data.options ?? [])
      : null,
    entity_type: parsed.data.entity_type ?? 'deal',
    group_name: parsed.data.group_name ?? null,
  };

  const { data, error } = await sb
    .from('custom_field_definitions')
    .insert(insertPayload)
    .select('id,key,label,type,options,entity_type,group_name,created_at')
    .single();

  if (error) {
    const msg = (error as any).message || 'Insert failed';
    const isDup = /duplicate key|unique/i.test(msg);
    return NextResponse.json({ error: isDup ? 'Já existe um campo com essa key' : msg }, { status: isDup ? 409 : 500 });
  }
  return NextResponse.json({ data: mapRow(data) }, { status: 201 });
}
