import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentRow } from './types';
import { loadFollowupCalendar } from './followupCalendarStore';
import { resolveReturnTime, type ReturnTimeInput } from './scheduledReturnTime';

export async function pendingRobotReturn(admin: SupabaseClient, org: string, conversation: string) {
  const { data, error } = await admin.from('wa_bot_runs').select('id, scheduled_for, scheduled_timezone, scheduled_anchor, bot_id')
    .eq('organization_id', org).eq('conversation_id', conversation).eq('status', 'running')
    .not('scheduled_for', 'is', null).is('scheduled_started_at', null).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export function scheduledReturnRuntime(admin: SupabaseClient, org: string, conversation: string, agent: AgentRow, anchor: string | null) {
  return {
    inspect: async () => ({ now: new Date().toISOString(), timezone: (await loadFollowupCalendar(admin, org)).timezone, pending: await pendingRobotReturn(admin, org, conversation) }),
    schedule: async (input: ReturnTimeInput) => {
      const at = resolveReturnTime(input);
      const bot = agent.tools?.scheduled_return_bot_id;
      if (!bot) throw new Error('Nenhum robô de retorno configurado');
      const { data, error } = await admin.rpc('schedule_robot_return', {
        p_org: org, p_conversation: conversation, p_agent: agent.id, p_bot: bot,
        p_at: at, p_timezone: input.timezone, p_anchor: anchor, p_context: input.context,
      });
      if (error) throw new Error(error.message);
      if (!data) throw new Error('Retorno não foi salvo');
      return { ok: true, id: data, scheduledAt: at, local: input.local, timezone: input.timezone, calendarException: true };
    },
    cancel: async () => {
      // Same lock as scheduling/start: a stale model turn cannot cancel a newer agreement.
      const { data, error } = await admin.rpc('cancel_scheduled_robot_return', {
        p_org: org, p_conversation: conversation, p_agent: agent.id, p_anchor: anchor,
      });
      if (error) throw new Error(error.message);
      return { ok: true, cancelled: data ?? 0 };
    },
  };
}
