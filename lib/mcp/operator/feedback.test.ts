import { describe, expect, it, vi } from 'vitest';
import { feedbackRegistry } from './feedback';

function admin(reply: unknown) {
  const rpc = vi.fn(async () => ({ data: reply, error: null }));
  const createSignedUrl = vi.fn(async (path: string) => ({ data: { signedUrl: `https://signed/${path}` }, error: null }));
  return { client: { rpc, storage: { from: () => ({ createSignedUrl }) } } as never, rpc, createSignedUrl };
}

describe('feedbackRegistry', () => {
  it('expõe só as três ferramentas da esteira', () => {
    const r = feedbackRegistry(admin({}).client, 'k1');
    expect(r.tools.map(t => t.name).sort()).toEqual(['crm.feedback.get', 'crm.feedback.list', 'crm.feedback.update']);
    expect(Object.keys(r.toolByMcpName).sort()).toEqual(['crm.feedback.get', 'crm.feedback.list', 'crm.feedback.update']);
    expect(r.tools.find(t => t.name === 'crm.feedback.update')?.annotations?.readOnlyHint).toBe(false);
  });
  it('chama a função do banco com a chave', async () => {
    const a = admin({ requests: [] });
    await feedbackRegistry(a.client, 'k1').toolByMcpName['crm.feedback.list'].execute!({ status: 'recebido' });
    expect(a.rpc).toHaveBeenCalledWith('aj_operator_feedback', { p_key_id: 'k1', p_tool: 'crm.feedback.list', p_args: { status: 'recebido' } });
  });
  it('troca o caminho dos anexos por link temporário no get', async () => {
    const a = admin({ request: { id: 'r1' }, attachments: [{ id: 'a1', storage_path: 'o/u/x_a.png', kind: 'image' }], messages: [] });
    const out = await feedbackRegistry(a.client, 'k1').toolByMcpName['crm.feedback.get'].execute!({ requestId: 'r1' }) as { attachments: Array<Record<string, unknown>> };
    expect(out.attachments[0].url).toBe('https://signed/o/u/x_a.png');
    expect(out.attachments[0].storage_path).toBeUndefined();
    expect(a.createSignedUrl).toHaveBeenCalledWith('o/u/x_a.png', 3600);
  });
  it('devolve erro genérico se o banco falhar', async () => {
    const client = { rpc: async () => ({ data: null, error: new Error('x') }), storage: { from: () => ({}) } } as never;
    const out = await feedbackRegistry(client, 'k1').toolByMcpName['crm.feedback.list'].execute!({});
    expect(out).toMatchObject({ code: 'FEEDBACK_UNAVAILABLE' });
  });
  it('valida os argumentos antes de chegar ao banco', () => {
    const r = feedbackRegistry(admin({}).client, 'k1');
    const update = r.toolByMcpName['crm.feedback.update'].inputSchema as { safeParse: (v: unknown) => { success: boolean } };
    const id = '00000000-0000-4000-8000-000000000001';
    expect(update.safeParse({ requestId: id, status: 'corrigido', tutorialUrl: 'https://exemplo.test/tutorial' }).success).toBe(true);
    expect(update.safeParse({ requestId: id, tutorialUrl: 'http://exemplo.test/tutorial' }).success).toBe(false);
    expect(update.safeParse({ requestId: id, status: 'apagado' }).success).toBe(false);
    expect(update.safeParse({ requestId: id, body: 'trocar o texto do pedido' }).success).toBe(false);
    const list = r.toolByMcpName['crm.feedback.list'].inputSchema as { safeParse: (v: unknown) => { success: boolean } };
    expect(list.safeParse({ limit: 51 }).success).toBe(false);
    expect(list.safeParse({ afterCreatedAt: 'ontem' }).success).toBe(false);
    expect(list.safeParse({ organizationId: id }).success).toBe(false);
  });
});
