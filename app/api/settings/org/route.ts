import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { withTabOrg } from '@/lib/supabase/tabOrgScope';

export const runtime = 'nodejs';

/**
 * Preferências da ORGANIZAÇÃO (não-IA). Hoje: etapa "Inativos" (opcional).
 * GET: qualquer membro logado lê. PATCH: só admin/super_admin altera.
 */

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

export async function GET() {
  const auth = await getAuthedProfile();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sb = createStaticAdminClient();
  // select('*') com leitura opcional: tolera banco ainda sem as colunas de
  // motivos (ordem deploy x migração), sem derrubar o GET pra todo mundo.
  const { data, error } = await sb
    .from('organization_settings')
    .select('*')
    .eq('organization_id', auth.profile.organization_id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const row = (data ?? {}) as Record<string, unknown>;
  return NextResponse.json({
    inactive_leads_enabled: !!row.inactive_leads_enabled,
    // null = organização usa os motivos padrão do sistema
    loss_reasons_qualified: (row.loss_reasons_qualified as string[] | null | undefined) ?? null,
    loss_reasons_disqualified: (row.loss_reasons_disqualified as string[] | null | undefined) ?? null,
  });
}

/**
 * Sanitiza uma lista de motivos: tira duplicatas (sem diferenciar
 * maiúsculas/acentos de caixa) e o rótulo reservado "Outro", que o modal
 * sempre acrescenta por conta própria.
 */
function sanitizeReasons(reasons: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const reason of reasons) {
    const key = reason.trim().toLowerCase();
    if (!key || key === 'outro' || seen.has(key)) continue;
    seen.add(key);
    result.push(reason.trim());
  }
  return result;
}

// Lista de motivos: até 20 itens de até 80 caracteres; null = voltar ao padrão.
const LossReasonsSchema = z
  .union([z.array(z.string().trim().min(1).max(80)).max(20), z.null()])
  .optional();

const PatchSchema = z.object({
  inactive_leads_enabled: z.boolean().optional(),
  loss_reasons_qualified: LossReasonsSchema,
  loss_reasons_disqualified: LossReasonsSchema,
}).strict();

export async function PATCH(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const auth = await getAuthedProfile();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!isAdmin(auth.profile.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 422 });
  }

  // Grava só o que veio no payload; lista vazia equivale a voltar ao padrão.
  const updates: Record<string, unknown> = {};
  if (parsed.data.inactive_leads_enabled !== undefined) {
    updates.inactive_leads_enabled = parsed.data.inactive_leads_enabled;
  }
  if (parsed.data.loss_reasons_qualified !== undefined) {
    const clean = sanitizeReasons(parsed.data.loss_reasons_qualified ?? []);
    updates.loss_reasons_qualified = clean.length > 0 ? clean : null;
  }
  if (parsed.data.loss_reasons_disqualified !== undefined) {
    const clean = sanitizeReasons(parsed.data.loss_reasons_disqualified ?? []);
    updates.loss_reasons_disqualified = clean.length > 0 ? clean : null;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 422 });
  }

  const sb = createStaticAdminClient();
  const { error } = await sb
    .from('organization_settings')
    .upsert(
      {
        organization_id: auth.profile.organization_id,
        ...updates,
      },
      { onConflict: 'organization_id' }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, ...updates });
}
