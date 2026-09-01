/**
 * PATCH /api/whatsapp/conversations/[id]
 *   { assignedOwnerId?: string | null, tags?: string[] }
 *
 * Responsável e etiquetas da conversa. Qualquer MEMBRO da organização pode
 * mexer (é organização de atendimento: quem está no chat assume a conversa),
 * mas só em conversa da PRÓPRIA organização — o filtro por organization_id
 * está em todas as consultas.
 *
 * O responsável pode ser limpo (null); as etiquetas são texto livre, iguais
 * às do negócio, normalizadas aqui (sem espaço nas pontas, sem repetida).
 */
import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** Teto de etiquetas por conversa: passa disso vira poluição na lista. */
const MAX_ETIQUETAS = 10;
const MAX_TAMANHO = 40;

export async function PATCH(req: Request, ctx: Ctx) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const orgId = auth.user.organizationId;

  let body: { assignedOwnerId?: unknown; tags?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }

  const patch: Record<string, unknown> = {};

  if ('assignedOwnerId' in body) {
    const valor = body.assignedOwnerId;
    if (valor === null || valor === '') {
      patch.assigned_owner_id = null;
    } else if (typeof valor === 'string') {
      // Mesma regra de membresia do resto do CRM: vínculo explícito em
      // user_organizations OU perfil (não super admin) com esta org ativa.
      // Super admin da agência sem vínculo resolve o nome mas não assume
      // conversa — ver /api/org/members.
      const [{ data: vinculo }, { data: perfil }] = await Promise.all([
        auth.admin
          .from('user_organizations')
          .select('user_id')
          .eq('organization_id', orgId)
          .eq('user_id', valor)
          .maybeSingle(),
        auth.admin.from('profiles').select('id, role, organization_id').eq('id', valor).maybeSingle(),
      ]);
      const p = perfil as { role?: string; organization_id?: string } | null;
      const ehMembro = !!vinculo || (!!p && p.role !== 'super_admin' && p.organization_id === orgId);
      if (!ehMembro) return json({ error: 'Responsável não é membro desta organização' }, 400);
      patch.assigned_owner_id = valor;
    } else {
      return json({ error: 'Responsável inválido' }, 400);
    }
  }

  if ('tags' in body) {
    if (!Array.isArray(body.tags)) return json({ error: 'Etiquetas devem ser uma lista' }, 400);
    const vistas = new Set<string>();
    const limpas: string[] = [];
    for (const bruta of body.tags) {
      if (typeof bruta !== 'string') continue;
      const tag = bruta.trim().slice(0, MAX_TAMANHO);
      if (!tag) continue;
      const chave = tag.toLowerCase();
      if (vistas.has(chave)) continue;
      vistas.add(chave);
      limpas.push(tag);
      if (limpas.length >= MAX_ETIQUETAS) break;
    }
    patch.tags = limpas;
  }

  if (Object.keys(patch).length === 0) return json({ error: 'Nada para alterar' }, 400);

  const { data, error } = await auth.admin
    .from('wa_conversations')
    .update(patch)
    .eq('organization_id', orgId)
    .eq('id', id)
    .select('id, assigned_owner_id, tags')
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: 'Conversa não encontrada' }, 404);

  return json({ ok: true, conversation: data });
}

