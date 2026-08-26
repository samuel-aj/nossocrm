/**
 * /api/wa-agents/bots  (admin)
 *   GET  -> { bots: BotRow[] }  (segredo do passo webhook mascarado)
 *   POST -> BotInputSchema -> 201 { bot }
 *           (aceita start_step_id e os campos do quadro nos passos: next_step_id, ui, passo webhook;
 *           segredo mascarado vira vazio)
 */
import { json } from '@/lib/whatsapp/api';
import { BotInputSchema, type BotRow } from '@/lib/wa-agents/types';
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
  const auth = await guardRoute({ admin: true });
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.admin
    .from('wa_bots')
    .select('*')
    .eq('organization_id', auth.user.organizationId)
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

  const stepsError = validateBotSteps(steps, input.start_step_id);
  if (stepsError) return stepsError;

  try {
    if (input.connection_id && !(await connectionsBelongToOrg(auth.admin, auth.user.organizationId, [input.connection_id]))) {
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
      connection_id: input.connection_id,
      trigger: input.trigger,
      steps,
      start_step_id: input.start_step_id ?? null,
      organization_id: auth.user.organizationId,
      created_by: auth.user.id,
    })
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({ bot: toBotPublic(data as BotRow) }, 201);
}
