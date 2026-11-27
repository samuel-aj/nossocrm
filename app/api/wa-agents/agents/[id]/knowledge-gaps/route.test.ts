import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ guard: vi.fn(), list: vi.fn() }));

vi.mock('../../../_shared', async importOriginal => ({
  ...await importOriginal<object>(),
  guardRoute: async (options: unknown) => {
    h.guard(options);
    return { ok: true, user: { id: 'admin-user', organizationId: 'org' }, admin: {}, isAdmin: true };
  },
  agentBelongsToOrg: async () => true,
}));
vi.mock('@/lib/wa-agents/knowledgeGaps', async importOriginal => ({ ...await importOriginal<object>(), listKnowledgeGaps: h.list }));

import { GET } from './route';

const agentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const get = (query: string) =>
  GET(new Request(`http://localhost/api/wa-agents/agents/${agentId}/knowledge-gaps${query}`), { params: Promise.resolve({ id: agentId }) });

beforeEach(() => {
  h.guard.mockClear();
  h.list.mockReset();
});

describe('GET /knowledge-gaps', () => {
  it('lista as abertas por padrão, só para administrador com agente liberado', async () => {
    const result = { gaps: [], counts: { open: 0, included: 0, ignored: 0 }, learned_by_document: {} };
    h.list.mockResolvedValue(result);
    const res = await get('');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(result);
    expect(h.list).toHaveBeenCalledWith({}, 'org', agentId, 'open');
    expect(h.guard).toHaveBeenCalledWith(expect.objectContaining({ admin: true, agents: true }));
  });

  it('recusa status desconhecido', async () => {
    expect((await get('?status=todas')).status).toBe(400);
    expect(h.list).not.toHaveBeenCalled();
  });
});
