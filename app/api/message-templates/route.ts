import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { withTabOrg } from '@/lib/supabase/tabOrgScope';
import { getBusinessConnectionByOrg, getConnectionByIdForOrg } from '@/lib/whatsapp/service';
import { isEvolutionBusinessConnection } from '@/lib/whatsapp';
import { createMetaTemplate } from '@/lib/whatsapp/templates';
import { TEMPLATE_BUTTON_LIMITS, toMetaBody, toMetaName } from '@/lib/messageTemplates';

const ButtonSchema = z
  .object({
    type: z.enum(['QUICK_REPLY', 'URL', 'PHONE_NUMBER']),
    text: z.string().trim().min(1).max(TEMPLATE_BUTTON_LIMITS.textLen),
    url: z.string().trim().url().max(2000).optional(),
    phone_number: z.string().trim().regex(/^\+?[0-9]{8,15}$/).optional(),
  })
  .strict()
  .refine(b => b.type !== 'URL' || !!b.url, { message: 'Botão de link precisa da URL' })
  .refine(b => b.type !== 'PHONE_NUMBER' || !!b.phone_number, { message: 'Botão de ligar precisa do telefone' });

const ButtonsSchema = z
  .array(ButtonSchema)
  .max(TEMPLATE_BUTTON_LIMITS.total)
  .refine(bs => bs.filter(b => b.type === 'URL').length <= TEMPLATE_BUTTON_LIMITS.url, {
    message: 'No máximo 2 botões de link',
  })
  .refine(bs => bs.filter(b => b.type === 'PHONE_NUMBER').length <= TEMPLATE_BUTTON_LIMITS.phone, {
    message: 'No máximo 1 botão de ligar',
  });

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
    /** Org com mais de um número de API: em qual conexão criar o modelo */
    connectionId: z.string().uuid().optional(),
    /** Só whatsapp_api: botões do template (criados na Meta junto) */
    buttons: ButtonsSchema.optional(),
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
    name: row.name as string,
    type: row.type as 'general' | 'whatsapp_api',
    category: (row.category ?? null) as 'UTILITY' | 'MARKETING' | null,
    language: (row.language ?? 'pt_BR') as string,
    body: row.body as string,
    meta_name: (row.meta_name ?? null) as string | null,
    meta_status: (row.meta_status ?? null) as string | null,
    connectionId: (row.connection_id ?? null) as string | null,
    buttons: (Array.isArray(row.buttons) ? row.buttons : null) as import('@/lib/messageTemplates').TemplateButton[] | null,
    created_at: row.created_at as string | null,
  };
}

export async function GET() {
  const auth = await getAuthedProfile();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sb = createStaticAdminClient();
  const { data, error } = await sb
    .from('message_templates')
    .select('id,name,type,category,language,body,meta_name,meta_status,connection_id,buttons,created_at')
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
  let connIdUsada: string | null = null;
  if (parsed.data.type === 'whatsapp_api') {
    const conn = parsed.data.connectionId
      ? await getConnectionByIdForOrg(sb, auth.profile.organization_id, parsed.data.connectionId)
      : await getBusinessConnectionByOrg(sb, auth.profile.organization_id);
    if (!conn || !['meta_cloud', 'evolution_business'].includes(String(conn.provider).toLowerCase()) || conn.status !== 'connected') {
      return NextResponse.json(
        { error: 'Conecte o WhatsApp API oficial (aba Conexão, no menu WhatsApp) antes de criar modelos da API' },
        { status: 400 }
      );
    }
    connIdUsada = conn.id;
    metaName = toMetaName(parsed.data.name);
    const meta = toMetaBody(parsed.data.body);
    const created = await createMetaTemplate(conn, {
      name: metaName,
      category: parsed.data.category as 'UTILITY' | 'MARKETING',
      language: parsed.data.language?.trim() || 'pt_BR',
      bodyText: meta.text,
      examples: meta.examples,
      buttons: parsed.data.buttons ?? null,
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
      ...(parsed.data.type === 'whatsapp_api' && connIdUsada ? { connection_id: connIdUsada } : {}),
      buttons: parsed.data.type === 'whatsapp_api' && parsed.data.buttons?.length ? parsed.data.buttons : null,
    })
    .select('id,name,type,category,language,body,meta_name,meta_status,connection_id,buttons,created_at')
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
