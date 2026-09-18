/**
 * POST /api/wa-agents/bots/[id]/duplicate  (admin) -> 201 { bot }
 *
 * Cópia independente do robô: balões, ligações, gatilho, números e
 * configurações de cada bloco (inclusive o segredo dos webhooks, que só o
 * servidor enxerga). Nasce DESLIGADA, para não disparar junto com o original,
 * e com o nome "Cópia de ...". Os ids dos passos podem repetir os do original:
 * eles só precisam ser únicos dentro do próprio robô.
 */
import { json } from '@/lib/whatsapp/api';
import { isValidUUID } from '@/lib/supabase/utils';
import type { BotRow } from '@/lib/wa-agents/types';
import { guardRoute, toBotPublic } from '../../../_shared';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const auth = await guardRoute({ req, admin: true });
  if (!auth.ok) return auth.response;
  const orgId = auth.user.organizationId;

  const { id } = await ctx.params;
  if (!isValidUUID(id)) return json({ error: 'ID inválido' }, 400);

  const { data: original, error: readError } = await auth.admin
    .from('wa_bots')
    .select('*')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (readError) return json({ error: readError.message }, 500);
  if (!original) return json({ error: 'Robô não encontrado' }, 404);
  const bot = original as BotRow;

  // Nome sem repetir: "Cópia de X", "Cópia 2 de X"...
  const { data: names } = await auth.admin.from('wa_bots').select('name').eq('organization_id', orgId);
  const taken = new Set(((names ?? []) as Array<{ name: string }>).map(n => n.name));
  const base = bot.name.slice(0, 100);
  let name = `Cópia de ${base}`;
  for (let n = 2; taken.has(name) && n < 100; n++) name = `Cópia ${n} de ${base}`;

  const { data, error } = await auth.admin
    .from('wa_bots')
    .insert({
      name: name.slice(0, 120),
      enabled: false,
      connection_id: bot.connection_id ?? null,
      connection_ids: bot.connection_ids ?? [],
      // cópia profunda: nada do original é compartilhado por referência
      trigger: structuredClone(bot.trigger ?? { type: 'manual' }),
      steps: structuredClone(bot.steps ?? []),
      start_step_id: bot.start_step_id ?? null,
      layout: structuredClone(bot.layout ?? { groups: [] }),
      organization_id: orgId,
      created_by: auth.user.id,
    })
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({ bot: toBotPublic(data as BotRow) }, 201);
}
