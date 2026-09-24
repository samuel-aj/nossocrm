import type { SupabaseClient } from '@supabase/supabase-js';
import { botResourceReferences, DEPENDENCY_LABELS, isAbstractReference, type DependencyKind } from './botTemplateDependencies';
import { pendingBotBindings } from './botTemplates';
import type { BotInput } from './types';

const CONVERSATION_STEPS = new Set(['send_text', 'send_template', 'typing', 'wait_reply', 'handoff_agent', 'start_bot']);

const TABLES: Partial<Record<DependencyKind, string>> = { connection: 'wa_connections', board: 'boards', stage: 'board_stages', message_template: 'message_templates', agent: 'wa_ai_agents', bot: 'wa_bots', custom_field: 'custom_field_definitions' };
/** Validates every executable reference against the destination organization, never the origin. */
export async function botResourceError(admin: SupabaseClient, orgId: string, bot: BotInput, requireComplete = bot.enabled): Promise<string | null> {
  const pending = pendingBotBindings(bot);
  if (requireComplete && pending.length) return `Vínculos pendentes: ${pending.join('; ')}`;
  const references = botResourceReferences(bot).filter(r => !isAbstractReference(r.value));
  for (const kind of [...new Set(references.map(r => r.kind))]) {
    if (kind === 'webhook') continue;
    const ids = [...new Set(references.filter(r => r.kind === kind).map(r => r.value))];
    if (kind === 'owner') {
      const [profiles, memberships] = await Promise.all([
        admin.from('profiles').select('id').eq('organization_id', orgId).in('id', ids),
        admin.from('user_organizations').select('user_id').eq('organization_id', orgId).in('user_id', ids),
      ]);
      if (profiles.error || memberships.error) throw new Error(profiles.error?.message || memberships.error?.message);
      const found = new Set([...(profiles.data ?? []).map(p => p.id), ...(memberships.data ?? []).map(p => p.user_id)]);
      if (ids.some(id => !found.has(id))) return 'Responsável não encontrado nesta organização';
      const { data: owners, error: ownerError } = await admin.from('profiles').select('id,role').in('id', ids);
      if (ownerError) throw new Error(ownerError.message);
      if ((owners ?? []).some(owner => owner.role === 'super_admin')) return 'Superadmin não pode ser responsável por negócios';
      if ((owners ?? []).length !== ids.length) return 'Responsável não encontrado nesta organização';
      continue;
    }
    const column = kind === 'custom_field' ? 'key' : 'id';
    let query = admin.from(TABLES[kind]!).select(column).eq('organization_id', orgId).in(column, ids);
    if (kind === 'board') query = query.is('deleted_at', null);
    if (kind === 'custom_field') query = query.eq('entity_type', 'deal');
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const found = new Set((data as unknown as Array<Record<string, string>> ?? []).map(r => r[column]));
    if (ids.some(id => !found.has(id))) return `${DEPENDENCY_LABELS[kind]} não encontrado nesta organização`;
  }
  // Board/stage associations must also be consistent, even when both belong to this organization.
  const pairs = [bot.trigger, ...bot.steps.filter(s => s.type === 'move_stage' || s.type === 'create_lead')];
  for (const pair of pairs) {
    if (!pair.board_id || !pair.stage_id || isAbstractReference(pair.board_id) || isAbstractReference(pair.stage_id)) continue;
    const { data, error } = await admin.from('board_stages').select('id').eq('organization_id', orgId).eq('board_id', pair.board_id).eq('id', pair.stage_id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return 'A etapa escolhida não pertence ao quadro de destino';
  }
  if (requireComplete) {
    const numbers = bot.connection_ids.length ? bot.connection_ids : bot.connection_id ? [bot.connection_id] : [];
    if (!numbers.length && bot.steps.some(step => CONVERSATION_STEPS.has(step.type))) return 'Escolha em quais números o robô atende antes de ligá-lo';
    if (bot.trigger.connection_id && !numbers.includes(bot.trigger.connection_id)) return 'O número do gatilho precisa estar selecionado no robô';
    if (bot.trigger.type === 'deal_stage_entered' && !bot.trigger.stage_id) return 'Escolha a etapa do gatilho antes de ligar';
  }
  return null;
}
