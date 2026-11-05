import { json } from '@/lib/whatsapp/api';
import { FollowupCalendarSchema } from '@/lib/wa-agents/followupCalendar';
import { loadFollowupCalendar } from '@/lib/wa-agents/followupCalendarStore';
import { getErrorMessage, guardRoute, readJsonBody, validationError } from '../_shared';

export async function GET() {
  const auth = await guardRoute({ admin: true });
  if (!auth.ok) return auth.response;
  try { return json({ calendar: await loadFollowupCalendar(auth.admin, auth.user.organizationId) }); }
  catch (error) { return json({ error: getErrorMessage(error, 'Falha ao carregar horários') }, 503); }
}

export async function PUT(req: Request) {
  const auth = await guardRoute({ req, admin: true });
  if (!auth.ok) return auth.response;
  const parsed = FollowupCalendarSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return validationError(parsed.error);
  const { error } = await auth.admin.from('followup_calendars').upsert({
    organization_id: auth.user.organizationId, ...parsed.data,
    updated_at: new Date().toISOString(), updated_by: auth.user.id,
  }, { onConflict: 'organization_id' });
  if (error) return json({ error: 'Não foi possível salvar os horários de follow-up' }, 503);
  return json({ calendar: parsed.data });
}
