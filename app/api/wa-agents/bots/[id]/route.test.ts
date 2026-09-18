import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ enabled: false, update: vi.fn() }));
const numberA = '10000000-0000-4000-8000-000000000001';
const numberB = '10000000-0000-4000-8000-000000000002';
const templateId = '20000000-0000-4000-8000-000000000001';

vi.mock('../../_shared', () => ({
  guardRoute: async () => ({
    ok: true,
    user: { organizationId: 'org' },
    admin: { from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        update: h.update,
        maybeSingle: async () => ({ data: {
          enabled: h.enabled, connection_ids: [numberA], connection_id: numberA,
          steps: [{ id: 'step', type: 'send_template', template_id: templateId }],
          trigger: { type: 'manual' }, layout: { groups: [] },
        } }),
        in: async () => ({ data: table === 'message_templates' ? [{ id: templateId, name: 'API A', type: 'whatsapp_api', meta_status: 'APPROVED', connection_id: numberA }] : [] }),
      };
      return query;
    } },
  }),
  dropDeletedConnections: async (_admin: unknown, ids: string[]) => ids,
  connectionsBelongToOrg: async () => true,
  readJsonBody: (req: Request) => req.json(),
  pickPresentKeys: (raw: object, parsed: Record<string, unknown>) => Object.fromEntries(Object.keys(raw).map(key => [key, parsed[key]])),
  validateBotSteps: () => null,
  getErrorMessage: (error: Error) => error.message,
}));

import { PATCH } from './route';

beforeEach(() => { h.update.mockReset(); h.enabled = false; });

describe('ativação e troca de número de robôs', () => {
  it.each([
    { enabled: true, connection_ids: [numberA, numberB] },
    { connection_ids: [numberB] },
    { connection_id: numberB },
  ])('bloqueia incompatibilidade sem gravar: %j', async patch => {
    h.enabled = !('enabled' in patch);
    const response = await PATCH(new Request('http://localhost/api/wa-agents/bots/id', {
      method: 'PATCH', body: JSON.stringify(patch),
    }), { params: Promise.resolve({ id: '30000000-0000-4000-8000-000000000001' }) });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('apenas esse número');
    expect(h.update).not.toHaveBeenCalled();
  });
});
