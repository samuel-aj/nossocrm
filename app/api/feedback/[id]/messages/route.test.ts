import { beforeEach, describe, expect, it, vi } from 'vitest';

type Update = { row: Record<string, unknown>; filters: Array<[string, unknown]>; selected?: string };
const db = {
  request: null as Record<string, string> | null,
  updatedRows: [] as Array<{ id: string }>,
  messageError: null as null | { message: string },
  steps: [] as string[],
  updates: [] as Update[],
  messages: [] as unknown[],
};

vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));
vi.mock('@/lib/whatsapp/api', () => ({
  json: (body: unknown, status = 200) => Response.json(body, { status }),
  requireOrgUser: async () => ({ ok: true, user: { id: 'u1', organizationId: 'o1', role: 'user' }, admin: {
    from: (t: string) => t === 'feedback_requests'
      ? {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.request, error: null }) }) }),
          update: (row: Record<string, unknown>) => {
            const entry: Update = { row, filters: [] };
            db.updates.push(entry);
            db.steps.push(`update:${String(row.status)}`);
            const chain = {
              eq: (col: string, value: unknown) => { entry.filters.push([col, value]); return chain; },
              select: async (cols: string) => { entry.selected = cols; return { data: db.updatedRows, error: null }; },
              then: (ok: (v: unknown) => void) => ok({ error: null }),
            };
            return chain;
          },
        }
      : { insert: async (row: unknown) => { db.steps.push('message'); db.messages.push(row); return { error: db.messageError }; } },
  } }),
}));

import { POST } from './route';

const requestId = '00000000-0000-4000-8000-000000000001';
const call = (body: unknown) => POST(new Request('https://crm.test/x', { method: 'POST', body: JSON.stringify(body) }),
  { params: Promise.resolve({ id: requestId }) });

describe('POST /api/feedback/[id]/messages', () => {
  beforeEach(() => {
    db.request = { id: requestId, author_id: 'u1', organization_id: 'o1', status: 'precisa_detalhes' };
    db.updatedRows = [{ id: requestId }];
    db.messageError = null;
    db.steps = []; db.updates = []; db.messages = [];
  });

  it('devolve o pedido para recebido só se ainda pede detalhes e depois grava a resposta', async () => {
    const res = await call({ body: 'Acontece na tela do lead' });
    expect(res.status).toBe(201);
    expect(db.steps).toEqual(['update:recebido', 'message']);
    expect(db.updates[0]).toEqual({
      row: { status: 'recebido' }, selected: 'id',
      filters: [['id', requestId], ['author_id', 'u1'], ['status', 'precisa_detalhes']],
    });
    expect(db.messages[0]).toMatchObject({ request_id: requestId, organization_id: 'o1', author_kind: 'user', author_id: 'u1', body: 'Acontece na tela do lead' });
  });

  it('responde 409 quando nenhuma linha mudou (status já é outro ou mudou no meio do caminho)', async () => {
    db.updatedRows = [];
    expect((await call({ body: 'x' })).status).toBe(409);
    expect(db.messages).toHaveLength(0);
  });

  it('se a mensagem não grava, volta o status para precisa_detalhes e devolve 500', async () => {
    db.messageError = { message: 'insert failed' };
    const res = await call({ body: 'Acontece na tela do lead' });
    expect(res.status).toBe(500);
    expect(db.steps).toEqual(['update:recebido', 'message', 'update:precisa_detalhes']);
    expect(db.updates[1]).toMatchObject({
      row: { status: 'precisa_detalhes' }, filters: [['id', requestId], ['status', 'recebido']],
    });
  });

  it('não deixa responder pedido de outra pessoa', async () => {
    db.request = { ...db.request!, author_id: 'u2' };
    expect((await call({ body: 'x' })).status).toBe(404);
    expect(db.updates).toHaveLength(0);
  });
});
