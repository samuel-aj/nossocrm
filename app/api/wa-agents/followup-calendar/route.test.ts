import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ guard: vi.fn(), upsert: vi.fn(), load: vi.fn() }));
vi.mock('../_shared', () => ({ guardRoute: h.guard, readJsonBody: (r: Request) => r.json(), validationError: () => Response.json({ error: 'inválido' }, { status: 400 }), getErrorMessage: () => 'indisponível' }));
vi.mock('@/lib/whatsapp/api', () => ({ json: (body: unknown, status = 200) => Response.json(body, { status }) }));
vi.mock('@/lib/wa-agents/followupCalendarStore', () => ({ loadFollowupCalendar: h.load }));
import { GET, PUT } from './route';
const calendar = { enabled: true, timezone: 'America/Manaus', slots: [{ day: 1, start: '09:00', end: '18:00' }] };
beforeEach(() => {
  vi.clearAllMocks();
  h.guard.mockResolvedValue({ ok: true, user: { id: 'user', organizationId: 'org' }, admin: { from: () => ({ upsert: h.upsert }) } });
  h.upsert.mockResolvedValue({ error: null }); h.load.mockResolvedValue(calendar);
});
it('requires administrator and mutation origin guards', async () => {
  const req = new Request('https://crm.test/api', { method: 'PUT', body: JSON.stringify(calendar) });
  expect((await PUT(req)).status).toBe(200);
  expect(h.guard).toHaveBeenCalledWith({ req, admin: true });
  expect(h.upsert).toHaveBeenCalledWith(expect.objectContaining({ organization_id: 'org', updated_by: 'user', ...calendar }), { onConflict: 'organization_id' });
});
it('does not accept a different organization in the body', async () => {
  expect((await PUT(new Request('https://crm.test/api', { method: 'PUT', body: JSON.stringify({ ...calendar, organization_id: 'foreign' }) }))).status).toBe(400);
  expect(h.upsert).not.toHaveBeenCalled();
});
it('rejects non-administrators without touching data', async () => {
  h.guard.mockResolvedValue({ ok: false, response: Response.json({}, { status: 403 }) });
  expect((await GET()).status).toBe(403); expect(h.load).not.toHaveBeenCalled();
});
it('does not return an unrestricted calendar on read failure', async () => {
  h.load.mockRejectedValue(new Error('offline'));
  expect((await GET()).status).toBe(503);
});
