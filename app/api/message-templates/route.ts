import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { getConnectionByOrg } from '@/lib/whatsapp/service';
import { isBusinessConnection } from '@/lib/whatsapp';
import { createMetaTemplate } from '@/lib/whatsapp/templates';
import { toMetaBody, toMetaName } from '@/lib/messageTemplates';

export const runtime = 'nodejs';

// Modelos de mensagem: 'general' (uso livre nas conversas) e 'whatsapp_api'
// (API oficial da Meta; exige categoria UTILITY | MARKETING e idioma).
const CreateSchema = z
  .object({
    name: z.string().min(1).max(120),
    type: z.enum(['general', 'whatsapp_api']),
    category: z.enum(['UTILITY', 'MARKETING']).nullable().optional(),
    language: z.string().min(2).max(10).optional(),
    body: z.string().min(1).max(4000),
  })
  .strict()
  .refine(v => v.type !== 'whatsapp_api' || !!v.category, {
    message: 'Modelos do WhatsApp API exigem a categoria (UTILITY ou MARKETING)',
  });

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

export async function GET() {
  const auth = await getAuthedProfile();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sb = createStaticAdminClient();
  const { data, error } = await sb
    .from('message_templates')
    .select('id,name,type,category,language,body,meta_name,meta_status,created_at')
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
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 422 });
  }

  const sb = createStaticAdminClient();

  // Modelo do WhatsApp API: cria o template NA META (via Evolution) antes de
  // salvar no CRM — o modelo nasce sincronizado, com status PENDING até a
  // aprovação da Meta chegar (botão Sincronizar atualiza).
  let metaName: string | null = null;
  let metaStatus: string | null = null;
  if (parsed.data.type === 'whatsapp_api') {
    const conn = await getConnectionByOrg(sb, auth.profile.organization_id);
    if (!conn || !isBusinessConnection(conn) || conn.status !== 'connected') {
      return NextResponse.json(
        { error: 'Conecte o WhatsApp API oficial (aba Conexão, no menu WhatsApp) antes de criar modelos da API' },
        { status: 400 }
      );
    }
    metaName = toMetaName(parsed.data.name);
    const meta = toMetaBody(parsed.data.body);
    const created = await createMetaTemplate(conn, {
      name: metaName,
      category: parsed.data.category as 'UTILITY' | 'MARKETING',
      language: parsed.data.language?.trim() || 'pt_BR',
      bodyText: meta.text,
      examples: meta.examples,
    });
    if (!created.ok) {
      return NextResponse.json({ error: `A Meta recusou o template: ${created.error}` }, { status: 502 });
    }
    metaStatus = 'PENDING';
  }

  const { data, error } = await sb
    .from('message_templates')
    .insert({
      organization_id: auth.profile.organization_id,
      name: parsed.data.name.trim(),
      type: parsed.data.type,
      category: parsed.data.type === 'whatsapp_api' ? parsed.data.category : null,
      language: parsed.data.language?.trim() || 'pt_BR',
      body: parsed.data.body,
      meta_name: metaName,
      meta_status: metaStatus,
      ...(metaName ? { synced_at: new Date().toISOString() } : {}),
    })
    .select('id,name,type,category,language,body,meta_name,meta_status,created_at')
    .single();

  if (error) {
    const msg = (error as any).message || 'Insert failed';
    const isDup = /duplicate key|unique/i.test(msg);
    return NextResponse.json(
      { error: isDup ? 'Já existe um modelo com esse nome' : msg },
      { status: isDup ? 409 : 500 }
    );
  }
  return NextResponse.json({ data: mapRow(data) }, { status: 201 });
}
