import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
  todayCount: 0, attachmentsFail: false,
  inserted: [] as Array<{ table: string; row: unknown }>,
  deleted: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
};

function table(name: string) {
  return {
    delete: () => {
      const entry = { table: name, filters: [] as Array<[string, unknown]> };
      state.deleted.push(entry);
      const chain = {
        eq: (col: string, value: unknown) => { entry.filters.push([col, value]); return chain; },
        then: (ok: (v: unknown) => void) => ok({ error: null }),
      };
      return chain;
    },
    select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
      if (opts?.head) {
        return { eq: () => ({ gte: async () => ({ count: state.todayCount, error: null }) }) };
      }
      return { eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) };
    },
    insert: (row: unknown) => {
      state.inserted.push({ table: name, row });
      return {
        select: () => ({ single: async () => ({ data: { id: 'r1', status: 'recebido', created_at: 'now' }, error: null }) }),
        then: (ok: (v: unknown) => void) => ok({
          error: name === 'feedback_attachments' && state.attachmentsFail ? { message: 'insert failed' } : null,
        }),
      };
    },
  };
}

vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));
vi.mock('@/lib/whatsapp/api', () => ({
  json: (body: unknown, status = 200) => Response.json(body, { status }),
  requireOrgUser: async () => ({ ok: true, user: { id: 'u1', organizationId: 'o1', role: 'user' }, admin: { from: table } }),
}));

import { POST } from './route';

const post = (body: unknown) => POST(new Request('https://crm.test/api/feedback', {
  method: 'POST', body: JSON.stringify(body), headers: { 'user-agent': 'Mozilla/5.0 (iPhone)' },
}));

describe('POST /api/feedback', () => {
  beforeEach(() => { state.todayCount = 0; state.attachmentsFail = false; state.inserted = []; state.deleted = []; });

  it('cria o pedido com contexto e anexos', async () => {
    const res = await post({ kind: 'bug', body: 'O botão some', screenPath: '/boards',
      attachments: [{ path: 'o1/u1/x_a.png', kind: 'image', mime: 'image/png', size: 10 }] });
    expect(res.status).toBe(201);
    const req = state.inserted.find(i => i.table === 'feedback_requests')?.row as Record<string, unknown>;
    expect(req).toMatchObject({ organization_id: 'o1', author_id: 'u1', kind: 'bug', device: 'celular', screen_path: '/boards' });
    const att = state.inserted.find(i => i.table === 'feedback_attachments')?.row as Array<Record<string, unknown>>;
    expect(att[0]).toMatchObject({ request_id: 'r1', organization_id: 'o1', storage_path: 'o1/u1/x_a.png' });
  });

  it('se os anexos não registram, apaga o pedido recém-criado e devolve 500', async () => {
    state.attachmentsFail = true;
    const res = await post({ body: 'Com print', attachments: [{ path: 'o1/u1/x_a.png', kind: 'image', mime: 'image/png', size: 10 }] });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Não foi possível registrar os anexos. Tente de novo.' });
    expect(state.deleted).toEqual([{ table: 'feedback_requests', filters: [['id', 'r1']] }]);
  });

  it('pedido sem anexos não apaga nada', async () => {
    expect((await post({ body: 'Só texto' })).status).toBe(201);
    expect(state.deleted).toHaveLength(0);
  });

  it('recusa anexo fora da pasta da pessoa', async () => {
    const res = await post({ body: 'x', attachments: [{ path: 'o1/u2/x_a.png', kind: 'image', mime: 'image/png', size: 10 }] });
    expect(res.status).toBe(422);
    expect(state.inserted).toHaveLength(0);
  });

  it('para no limite de 20 por dia', async () => {
    state.todayCount = 20;
    const res = await post({ body: 'x' });
    expect(res.status).toBe(429);
  });

  it('recusa envio vazio', async () => {
    expect((await post({ body: '  ' })).status).toBe(422);
  });
});
