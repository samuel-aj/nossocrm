import { NextResponse } from 'next/server';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { getConnectionByOrg } from '@/lib/whatsapp/service';
import { isEvolutionBusinessConnection } from '@/lib/whatsapp';
import { listMetaTemplates } from '@/lib/whatsapp/templates';

export const runtime = 'nodejs';

/**
 * POST /api/message-templates/sync
 * Sincroniza os modelos whatsapp_api com a META (via Evolution):
 *   - atualiza o status de aprovação dos modelos criados pelo CRM;
 *   - IMPORTA templates que já existem na Meta e o CRM ainda não conhece.
 */
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();
  if (!profile?.organization_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  if (profile.role !== 'admin' && profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sb = createStaticAdminClient();
  const conn = await getConnectionByOrg(sb, profile.organization_id);
  if (!conn || !isEvolutionBusinessConnection(conn) || conn.status !== 'connected') {
    return NextResponse.json(
      { error: 'Conecte o WhatsApp API oficial pra sincronizar os modelos com a Meta' },
      { status: 400 }
    );
  }

  const result = await listMetaTemplates(conn);
  if (!result.ok) {
    return NextResponse.json({ error: `Falha ao consultar a Meta: ${result.error}` }, { status: 502 });
  }

  const { data: rows } = await sb
    .from('message_templates')
    .select('id, meta_name, language')
    .eq('organization_id', profile.organization_id)
    .eq('type', 'whatsapp_api');
  const existing = rows ?? [];
  const now = new Date().toISOString();

  let updated = 0;
  let imported = 0;
  for (const t of result.templates) {
    const match = existing.find(
      r => r.meta_name === t.name && (!t.language || (r.language ?? 'pt_BR') === t.language)
    ) ?? existing.find(r => r.meta_name === t.name);

    const safeCategory = t.category === 'UTILITY' || t.category === 'MARKETING' ? t.category : null;

    if (match) {
      const { error } = await sb
        .from('message_templates')
        .update({
          meta_status: t.status,
          ...(safeCategory ? { category: safeCategory } : {}),
          synced_at: now,
          updated_at: now,
        })
        .eq('id', match.id);
      if (!error) updated += 1;
      continue;
    }

    // Template que só existe na Meta: importa pro CRM (nome legível a partir
    // do meta_name; em conflito de nome, ganha um sufixo)
    const readable = t.name.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
    const baseRow = {
      organization_id: profile.organization_id,
      type: 'whatsapp_api',
      category: safeCategory,
      language: t.language || 'pt_BR',
      body: t.bodyText ?? '',
      meta_name: t.name,
      meta_status: t.status,
      synced_at: now,
    };
    let ins = await sb.from('message_templates').insert({ ...baseRow, name: readable });
    if (ins.error && /duplicate key|unique/i.test(ins.error.message)) {
      ins = await sb.from('message_templates').insert({ ...baseRow, name: `${readable} (Meta)` });
    }
    if (!ins.error) imported += 1;
  }

  return NextResponse.json({ ok: true, updated, imported, total_meta: result.templates.length });
}
