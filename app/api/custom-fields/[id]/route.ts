import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { isValidUUID } from '@/lib/supabase/utils';
import { withTabOrg } from '@/lib/supabase/tabOrgScope';

export const runtime = 'nodejs';

const FieldTypeEnum = z.enum(['text', 'number', 'date', 'select', 'multiselect', 'currency']);

const UpdateSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  type: FieldTypeEnum.optional(),
  options: z.array(z.string()).optional(),
  group_name: z.string().min(1).max(60).nullable().optional(),
  /** Ordem manual dentro do grupo (migração 20260902130000) */
  position: z.number().int().min(0).max(100000).nullable().optional(),
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

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const auth = await getAuthedProfile();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!isAdmin(auth.profile.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await ctx.params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 422 });

  const body = await req.json().catch(() => null);
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 422 });
  }

  const updates: any = {};
  if (parsed.data.label !== undefined) updates.label = parsed.data.label;
  if (parsed.data.type !== undefined) updates.type = parsed.data.type;
  // null explícito desagrupa o campo
  if (parsed.data.group_name !== undefined) updates.group_name = parsed.data.group_name;
  if (parsed.data.position !== undefined) updates.position = parsed.data.position;

  // Options only apply to select-like types; for other types clear to null.
  const nextType = parsed.data.type;
  if (nextType !== undefined) {
    if (nextType === 'select' || nextType === 'multiselect') {
      updates.options = parsed.data.options ?? [];
    } else {
      updates.options = null;
    }
  } else if (parsed.data.options !== undefined) {
    // type not changed; trust the caller — the DB row already dictates type.
    updates.options = parsed.data.options;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 422 });
  }

  const sb = createStaticAdminClient();
  const { data, error } = await sb
    .from('custom_field_definitions')
    .update(updates)
    .eq('id', id)
    .eq('organization_id', auth.profile.organization_id)
    .select('id,key,label,type,options,entity_type,group_name,created_at')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ data: mapRow(data) });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const auth = await getAuthedProfile();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!isAdmin(auth.profile.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await ctx.params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 422 });

  const sb = createStaticAdminClient();
  const { error, count } = await sb
    .from('custom_field_definitions')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('organization_id', auth.profile.organization_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
