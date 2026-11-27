import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ denied: false, belongs: true, guard: vi.fn(), apply: vi.fn(), remove: vi.fn() }));

vi.mock('../../../../_shared', async importOriginal => ({
  ...await importOriginal<object>(),
  guardRoute: async (options: unknown) => {
    h.guard(options);
    if (h.denied) return { ok: false, response: new Response('Forbidden', { status: 403 }) };
    return { ok: true, user: { id: 'admin-user', organizationId: 'org' }, admin: {}, isAdmin: true };
  },
  agentBelongsToOrg: async () => h.belongs,
}));
vi.mock('@/lib/wa-agents/knowledgeGaps', async importOriginal => ({
  ...await importOriginal<object>(),
  applyKnowledgeGapAction: h.apply,
  deleteKnowledgeGap: h.remove,
}));

import { DELETE, PATCH } from './route';
import { KnowledgeGapError } from '@/lib/wa-agents/knowledgeGaps';

const agentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const gapId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const docId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const url = `http://localhost/api/wa-agents/agents/${agentId}/knowledge-gaps/${gapId}`;
const ctx = () => ({ params: Promise.resolve({ id: agentId, gapId }) });
const patch = (body: unknown) =>
  PATCH(new Request(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), ctx());
const include = { action: 'include', question: 'Qual o hotel?', answer: 'Mar Azul', document_id: docId };

beforeEach(() => {
  h.denied = false;
  h.belongs = true;
  h.guard.mockClear();
  h.apply.mockReset();
  h.remove.mockReset();
});

describe('PATCH /knowledge-gaps/[gapId]', () => {
  it('exige administrador com agente liberado e confere a origem', async () => {
    h.denied = true;
    expect((await patch({ action: 'ignore' })).status).toBe(403);
    expect(h.guard).toHaveBeenCalledWith(expect.objectContaining({ admin: true, agents: true, req: expect.any(Request) }));
    expect(h.apply).not.toHaveBeenCalled();
  });

  it('recusa inclusão sem documento de destino', async () => {
    expect((await patch({ action: 'include', question: 'Qual o hotel?', answer: 'Mar Azul' })).status).toBe(400);
    expect(h.apply).not.toHaveBeenCalled();
  });

  it('não mexe em dúvida de agente de outra organização', async () => {
    h.belongs = false;
    expect((await patch({ action: 'ignore' })).status).toBe(404);
    expect(h.apply).not.toHaveBeenCalled();
  });

  it('repassa a ação com o usuário e devolve a dúvida', async () => {
    h.apply.mockResolvedValue({ id: gapId, status: 'included' });
    const res = await patch(include);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ gap: { id: gapId, status: 'included' } });
    expect(h.apply).toHaveBeenCalledWith({}, { organizationId: 'org', agentId, gapId, userId: 'admin-user', action: include });
  });

  it('devolve apenas a mensagem pública quando a revisão falha internamente', async () => {
    h.apply.mockRejectedValue(new Error('detalhe interno da persistência'));
    const res = await patch(include);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Falha ao atualizar a dúvida' });
  });

  it('transforma o erro da regra em status e mensagem', async () => {
    h.apply.mockRejectedValue(new KnowledgeGapError('DOCUMENT_NOT_READY', 'O documento está sendo processado. Tente de novo em instantes.', 409));
    const res = await patch(include);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'O documento está sendo processado. Tente de novo em instantes.', code: 'DOCUMENT_NOT_READY' });
  });
});

describe('DELETE /knowledge-gaps/[gapId]', () => {
  it('exclui a dúvida do agente', async () => {
    h.remove.mockResolvedValue(undefined);
    const res = await DELETE(new Request(url, { method: 'DELETE' }), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.remove).toHaveBeenCalledWith({}, { organizationId: 'org', agentId, gapId });
  });
});
