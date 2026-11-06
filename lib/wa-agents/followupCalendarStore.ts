import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FollowupCalendarSchema, nextFollowupWindow, type FollowupCalendar } from './followupCalendar';

export const DEFAULT_FOLLOWUP_CALENDAR: FollowupCalendar = {
  enabled: false, timezone: 'America/Sao_Paulo',
  slots: [1, 2, 3, 4, 5].map(day => ({ day, start: '09:00', end: '18:00' })),
};

/** Missing configuration preserves existing behavior; failed reads never authorize a send. */
export async function loadFollowupCalendar(admin: SupabaseClient, organizationId: string): Promise<FollowupCalendar> {
  const { data, error } = await admin.from('followup_calendars')
    .select('enabled, timezone, slots').eq('organization_id', organizationId).maybeSingle();
  if (error) throw new Error(`Não foi possível consultar os horários de follow-up: ${error.message}`);
  return data ? FollowupCalendarSchema.parse({ enabled: data.enabled, timezone: data.timezone, slots: data.slots }) : DEFAULT_FOLLOWUP_CALENDAR;
}

export async function followupAllowedAt(admin: SupabaseClient, organizationId: string, now = new Date()): Promise<Date> {
  return nextFollowupWindow(await loadFollowupCalendar(admin, organizationId), now);
}
