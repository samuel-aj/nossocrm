/**
 * /api/wa-agents/bots
 *   GET  -> admin: { bots: BotRow[] }  (segredo do passo webhook mascarado)
 *           demais membros: { bots: BotMinimal[] }  (só os robôs ligados: menu do chat)
 *   POST -> (admin) BotInputSchema -> 201 { bot }
 *           (aceita start_step_id, layout (balões do quadro) e os campos do quadro nos passos:
 *           next_step_id, ui, passo webhook; segredo mascarado vira vazio; robô sem passos só
 *           pode ser salvo desligado)
 */
import { json } from '@/lib/whatsapp/api';
import { BotInputSchema, type BotMinimal, type BotRow } from '@/lib/wa-agents/types';
import {
  connectionNotFoundError,
  connectionsBelongToOrg,
  getErrorMessage,
  guardRoute,
  readJsonBody,
  restoreMaskedBotSecrets,
  toBotPublic,
  validateBotSteps,
  validationError,
} from '../_shared';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await guardRoute();
  if (!auth.ok) return auth.response;
  const orgId = auth.user.organizationId;

  if (!auth.isAdmin) {
    // Menu do chat: qualquer membro vê só id, nome e número dos robôs ligados
    const { data, error } = await auth.admin
      .from('wa_bots')
      .select('id, name, enabled, connection_id, connection_ids')
      .eq('organization_id', orgId)
      .eq('enabled', true)
      .order('name', { ascending: true });
    if (error) return json({ error: error.message }, 500);
    return json({ bots: (data ?? []) as BotMinimal[] });
  }

  const { data, error } = await auth.admin
    .from('wa_bots')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true });
  if (error) return json({ error: error.message }, 500);

  return json({ bots: ((data ?? []) as BotRow[]).map(toBotPublic) });
}

export async function POST(req: Request) {
  const auth = await guardRoute({ req, admin: true });
  if (!auth.ok) return auth.response;

  const parsed = BotInputSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return validationError(parsed.error);
  const input = parsed.data;
  const steps = restoreMaskedBotSecrets(input.steps, null);

  const stepsError = validateBotSteps(steps, input.start_step_id, input.layout, input.enabled);
  if (stepsError) return stepsError;

  try {
    const numeros = input.connection_ids?.length ? input.connection_ids : input.connection_id ? [input.connection_id] : [];
    if (numeros.length > 0 && !(await connectionsBelongToOrg(auth.admin, auth.user.organizationId, numeros))) {
      return connectionNotFoundError();
    }
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao validar o número') }, 500);
  }

  const { data, error } = await auth.admin
    .from('wa_bots')
    .insert({
      name: input.name,
      enabled: input.enabled,
      connection_id: input.connection_ids?.[0] ?? input.connection_id ?? null,
      connection_ids: input.connection_ids ?? [],
      trigger: input.trigger,
      steps,
      start_step_id: input.start_step_id ?? null,
      layout: input.layout,
      organization_id: auth.user.organizationId,
      created_by: auth.user.id,
    })
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({ bot: toBotPublic(data as BotRow) }, 201);
}
