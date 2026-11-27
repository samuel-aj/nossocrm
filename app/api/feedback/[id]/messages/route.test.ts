import { describe, expect, it, vi } from 'vitest';

const db = { request: { id: 'r1', author_id: 'u1', organization_id: 'o1', status: 'precisa_detalhes' } as Record<string, string> | null,
  updates: [] as unknown[], messages: [] as unknown[] };

vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));
vi.mock('@/lib/whatsapp/api', () => ({
  json: (body: unknown, status = 200) => Response.json(body, { status }),
  requireOrgUser: async () => ({ ok: true, user: { id: 'u1', organizationId: 'o1', role: 'user' }, admin: {
    from: (t: string) => t === 'feedback_requests'
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.request, error: null }) }) }),
          update: (row: unknown) => { db.updates.push(row); return { eq: async () => ({ error: null }) }; } }
      : { insert: async (row: unknown) => { db.messages.push(row); return { error: null }; } },
  } }),
}));

import { POST } from './route';

const call = (body: unknown) => POST(new Request('https://crm.test/x', { method: 'POST', body: JSON.stringify(body) }),
  { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }) });

describe('POST /api/feedback/[id]/messages', () => {
  it('grava a resposta e devolve o pedido para recebido', async () => {
    const res = await call({ body: 'Acontece na tela do lead' });
    expect(res.status).toBe(201);
    expect(db.messages[0]).toMatchObject({ author_kind: 'user', author_id: 'u1', body: 'Acontece na tela do lead' });
    expect(db.updates[0]).toEqual({ status: 'recebido' });
  });
  it('só responde quando o pedido pede detalhes', async () => {
    db.request = { ...db.request!, status: 'na_fila' };
    expect((await call({ body: 'x' })).status).toBe(409);
  });
  it('não deixa responder pedido de outra pessoa', async () => {
    db.request = { ...db.request!, status: 'precisa_detalhes', author_id: 'u2' };
    expect((await call({ body: 'x' })).status).toBe(404);
  });
});
