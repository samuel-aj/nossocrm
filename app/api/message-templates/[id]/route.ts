import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { isValidUUID } from '@/lib/supabase/utils';

export const runtime = 'nodejs';

const UpdateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    type: z.enum(['general', 'whatsapp_api']).optional(),
    category: z.enum(['UTILITY', 'MARKETING']).nullable().optional(),
    language: z.string().min(2).max(10).optional(),
    body: z.string().min(1).max(4000).optional(),
  })
  .strict();

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

function mapRow(row: any) {
  return {
    id: row.id as string,
    name: row.name as string,
    type: row.type as 'general' | 'whatsapp_api',
    category: (row.category ?? null) as 'UTILITY' | 'MARKETING' | null,
    language: (row.language ?? 'pt_BR') as string,
    body: row.body as string,
    meta_name: (row.meta_name ?? null) as string | null,
    meta_status: (row.meta_status ?? null) as string | null,
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

  const sb = createStaticAdminClient();

  // Modelo do WhatsApp API é um ESPELHO da Meta: o conteúdo não é editável
  // pelo CRM (a Meta trava templates aprovados). Pra mudar, crie um novo.
  const { data: current } = await sb
    .from('message_templates')
    .select('type')
    .eq('id', id)
    .eq('organization_id', auth.profile.organization_id)
    .maybeSingle();
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (current.type === 'whatsapp_api') {
    return NextResponse.json(
      { error: 'Modelos do WhatsApp API são sincronizados com a Meta e não podem ser editados. Crie um novo modelo.' },
      { status: 422 }
    );
  }

  const updates: any = { updated_at: new Date().toISOString() };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name.trim();
  if (parsed.data.type !== undefined) updates.type = parsed.data.type;
  if (parsed.data.category !== undefined) updates.category = parsed.data.category;
  if (parsed.data.language !== undefined) updates.language = parsed.data.language.trim() || 'pt_BR';
  if (parsed.data.body !== undefined) updates.body = parsed.data.body;
  // modelo geral nunca carrega categoria
  if (updates.type === 'general') updates.category = null;
  // trocar o tipo pra whatsapp_api por edição também não faz sentido (o
  // template teria que nascer na Meta) — mantém geral
  if (updates.type === 'whatsapp_api') delete updates.type;

  const { data, error } = await sb
    .from('message_templates')
    .update(updates)
    .eq('id', id)
    .eq('organization_id', auth.profile.organization_id)
    .select('id,name,type,category,language,body,meta_name,meta_status,created_at')
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
    .from('message_templates')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('organization_id', auth.profile.organization_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
