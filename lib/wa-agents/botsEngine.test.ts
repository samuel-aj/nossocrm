/**
 * Motor dos robôs ponta a ponta com banco e WhatsApp FALSOS (nada sai daqui):
 * várias ações no mesmo balão, falha de ação de CRM que não derruba o resto,
 * "Encerrar" valendo para a conversa, lead achado pela conversa e número
 * não selecionado.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  sent: [] as string[],
  typingCalls: [] as number[],
  moves: [] as Array<{ dealId: string; stageId: string }>,
  tags: [] as Array<{ dealId: string; tag: string }>,
  moveFails: false,
  deal: null as null | Record<string, unknown>,
  moveOpts: [] as Array<Record<string, unknown>>,
  removed: [] as string[],
  created: [] as Array<Record<string, unknown>>,
  updated: [] as Array<Record<string, unknown>>,
  lossHistory: 0,
}));

vi.mock('@/lib/whatsapp', () => ({
  getProvider: () => ({
    sendText: async ({ text }: { text: string }) => {
      h.sent.push(text);
      return { ok: true, providerMessageId: `m${h.sent.length}` };
    },
    sendTyping: async ({ ms }: { ms: number }) => {
      h.typingCalls.push(ms);
    },
  }),
}));
vi.mock('@/lib/whatsapp/service', () => ({
  ensureConversation: async () => ({ id: 'conv-new' }),
  getConnectionByIdForOrg: async (_a: unknown, _o: string, id: string) => ({ id, status: 'connected', phone_number: '+5511900000000', provider: 'evolution' }),
  recordOutboundMessage: async (_a: unknown, i: { text: string }) => ({ body: i.text }),
  replicateOutboundToSiblings: async () => {},
}));
vi.mock('@/lib/public-api/dealsMoveStage', () => ({
  moveStageByDealId: async (opts: { dealId: string; target: { to_stage_id: string } }) => {
    const { dealId, target } = opts;
    if (h.moveFails) return { ok: false, body: { error: 'Stage not found for this board' } };
    h.moves.push({ dealId, stageId: target.to_stage_id });
    h.moveOpts.push(opts as unknown as Record<string, unknown>);
    return { ok: true, body: {} };
  },
}));
vi.mock('./actions', () => ({
  addDealTag: async (_a: unknown, _o: string, dealId: string, tag: string) => {
    h.tags.push({ dealId, tag });
  },
}));
vi.mock('./context', () => ({
  loadDealContext: async (_a: unknown, _o: string, input: { dealId?: string | null; contactId?: string | null }) =>
    h.deal && (input.dealId === h.deal.id || input.contactId === h.deal.contact_id) ? { ...h.deal } : null,
  loadAgent: async () => null,
  loadConversationContext: async () => null,
  loadLastInboundProviderId: async () => null,
}));
vi.mock('./leadOps', () => ({
  removeDealTag: async (_a: unknown, _o: string, _d: string, tag: string) => {
    h.removed.push(tag);
    return tag === 'tem';
  },
  ensureLeadForContact: async (_a: unknown, input: Record<string, unknown>) => {
    h.created.push(input);
    h.deal = { id: 'deal-new', contact_id: 'contact-1', title: 'Novo', stage_id: input.stageId, board_id: input.boardId, tags: [], stage_label: 'Entrada' };
    return { created: true, dealId: 'deal-new', contactId: 'contact-1', problems: [] };
  },
  applyLeadChanges: async (_a: unknown, input: { changes: Array<{ value?: string }>; render: (t: string) => string }) => {
    h.updated.push({ ...input, rendered: input.changes.map((c) => input.render(c.value ?? '')) });
    return { changed: ['description'], problems: [] };
  },
  recordLossHistory: async () => {
    h.lossHistory++;
  },
}));
vi.mock('./engine', () => ({ runAgentOnConversation: async () => ({ status: 'ok' }) }));
vi.mock('./beta', () => ({ isAiAgentsApproved: async () => true }));
vi.mock('./webhooks', () => ({
  dispatchAgentEvent: async () => [],
  postWebhook: async () => ({ ok: false, error: 'HTTP 500' }),
}));

import { processBotRun } from './bots';
import type { BotRunRow } from './types';

type Row = Record<string, unknown>;

/** Supabase falso: tabelas em memória e o pedaço do query builder que o motor usa. */
function fakeDb(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let op: 'select' | 'update' | 'insert' = 'select';
    let patch: Row = {};
    let returning = false;
    let single = false;
    let limit: number | null = null;
    const rows = () => (tables[table] ??= []);
    const run = () => {
      let hit = rows().filter(r => filters.every(f => f(r)));
      if (op === 'update') hit.forEach(r => Object.assign(r, patch));
      if (limit !== null) hit = hit.slice(0, limit);
      const data = op === 'select' || returning ? hit.map(r => ({ ...r })) : null;
      if (single) return { data: data?.[0] ?? null, error: null };
      return { data, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => {
        if (op !== 'select') returning = true;
        return b;
      },
      update: (p: Row) => ((op = 'update'), (patch = p), b),
      eq: (c: string, v: unknown) => (filters.push(r => r[c] === v), b),
      neq: (c: string, v: unknown) => (filters.push(r => r[c] !== v), b),
      is: (c: string, v: unknown) => (filters.push(r => (r[c] ?? null) === v), b),
      in: (c: string, vs: unknown[]) => (filters.push(r => vs.includes(r[c])), b),
      order: () => b,
      limit: (n: number) => ((limit = n), b),
      maybeSingle: () => ((single = true), b),
      single: () => ((single = true), b),
      then: (resolve: (v: unknown) => void) => resolve(run()),
    };
    return b;
  };
  return { from, rpc: async () => ({ data: true, error: null }) } as never;
}

const ORG = 'org-1';

function bot(steps: Row[], extra: Row = {}): Row {
  return {
    id: 'bot-1',
    organization_id: ORG,
    name: 'Robô',
    enabled: true,
    steps,
    start_step_id: steps[0]?.id ?? null,
    connection_ids: ['conn-a'],
    connection_id: 'conn-a',
    trigger: { type: 'manual' },
    ...extra,
  };
}

function run(extra: Partial<BotRunRow> = {}): BotRunRow {
  return {
    id: 'run-1',
    organization_id: ORG,
    bot_id: 'bot-1',
    deal_id: null,
    contact_id: null,
    conversation_id: 'conv-1',
    phone: null,
    status: 'running',
    step_index: 0,
    vars: {},
    log: [],
    wake_at: null,
    ...extra,
  } as BotRunRow;
}

function db(botRow: Row, runs: Row[], conv: Row = {}) {
  return {
    wa_bots: [botRow],
    wa_bot_runs: runs,
    wa_conversations: [
      { id: 'conv-1', organization_id: ORG, wa_phone: '+5511988887777', connection_id: 'conn-a', contact_id: 'contact-1', deal_id: null, ...conv },
    ],
    contacts: [{ id: 'contact-1', organization_id: ORG, name: 'Maria Souza', phone: '+5511988887777', email: null }],
    deals: [{ id: 'deal-1', organization_id: ORG, contact_id: 'contact-1' }],
  } as Record<string, Row[]>;
}

beforeEach(() => {
  h.sent = [];
  h.typingCalls = [];
  h.moves = [];
  h.tags = [];
  h.moveFails = false;
  h.moveOpts = [];
  h.removed = [];
  h.created = [];
  h.updated = [];
  h.lossHistory = 0;
  h.deal = { id: 'deal-1', contact_id: 'contact-1', title: 'Lead', stage_id: 's1', board_id: 'b1', tags: [], stage_label: 'Novo' };
});

const chain = (steps: Row[]) =>
  steps.map((s, i) => ({ next_step_id: steps[i + 1]?.id ?? null, ...s }));

describe('motor dos robôs', () => {
  it('executa TODAS as ações do balão, com o lead achado pela conversa', async () => {
    const steps = chain([
      { id: 'a', type: 'send_text', text: 'Olá {{primeiro_nome}}' },
      { id: 'b', type: 'move_stage', stage_id: '00000000-0000-4000-8000-000000000001' },
      { id: 'c', type: 'add_tag', tag: 'quente' },
      { id: 'd', type: 'send_text', text: 'Pronto' },
    ]);
    const tables = db(bot(steps), [run()]);
    await processBotRun(fakeDb(tables), run());

    expect(h.sent).toEqual(['Olá Maria', 'Pronto']);
    expect(h.moves).toEqual([{ dealId: 'deal-1', stageId: '00000000-0000-4000-8000-000000000001' }]);
    expect(h.tags).toEqual([{ dealId: 'deal-1', tag: 'quente' }]);
    const saved = tables.wa_bot_runs[0];
    expect(saved.status).toBe('done');
    expect(saved.deal_id).toBe('deal-1');
    expect(saved.error ?? null).toBeNull();
  });

  it('falha de ação de CRM registra qual bloco falhou e o fluxo segue', async () => {
    h.moveFails = true;
    const steps = chain([
      { id: 'mv', type: 'move_stage', stage_id: '00000000-0000-4000-8000-000000000001' },
      { id: 'wh', type: 'webhook', url: 'https://example.com/x' },
      { id: 'tg', type: 'add_tag', tag: 'segue' },
      { id: 'tx', type: 'send_text', text: 'Depois das falhas' },
    ]);
    const tables = db(bot(steps), [run()]);
    await processBotRun(fakeDb(tables), run());

    expect(h.tags).toEqual([{ dealId: 'deal-1', tag: 'segue' }]);
    expect(h.sent).toEqual(['Depois das falhas']);
    const saved = tables.wa_bot_runs[0];
    expect(saved.status).toBe('done');
    const log = saved.log as Array<{ step_id: string; status?: string; error?: string }>;
    expect(log.find(e => e.step_id === 'mv')).toMatchObject({ status: 'failed', error: 'Stage not found for this board' });
    expect(log.find(e => e.step_id === 'wh')).toMatchObject({ status: 'failed' });
    expect(String(saved.error)).toContain('Webhook (wh)');
  });

  it('sem lead, a ação aparece como pulada (não some em silêncio)', async () => {
    h.deal = null;
    const steps = chain([{ id: 'tg', type: 'add_tag', tag: 'x' }]);
    const tables = db(bot(steps), [run()]);
    await processBotRun(fakeDb(tables), run());
    const saved = tables.wa_bot_runs[0];
    expect(saved.status).toBe('done');
    expect((saved.log as Array<{ status?: string }>).some(e => e.status === 'skipped')).toBe(true);
    expect(String(saved.error)).toContain('Adicionar tag (tg)');
  });

  it('mensagem que não sai continua parando o robô, com o bloco identificado', async () => {
    const steps = chain([
      { id: 'tx', type: 'send_text', text: 'Oi' },
      { id: 'tg', type: 'add_tag', tag: 'nao-chega' },
    ]);
    const tables = db(bot(steps, { connection_ids: ['conn-a'] }), [run()], {});
    const failing = fakeDb(tables);
    const service = await import('@/lib/whatsapp/service');
    const spy = vi.spyOn(service, 'getConnectionByIdForOrg').mockResolvedValue({ id: 'conn-a', status: 'disconnected' } as never);
    await processBotRun(failing, run());
    spy.mockRestore();
    const saved = tables.wa_bot_runs[0];
    expect(saved.status).toBe('error');
    expect(String(saved.error)).toContain('Mensagem (tx)');
    expect(h.tags).toEqual([]);
  });

  it('"Encerrar" cancela a outra execução ativa da mesma conversa', async () => {
    const steps = chain([{ id: 'fim', type: 'end' }]);
    const other = { ...run({ id: 'run-2', status: 'waiting_reply' }), wake_at: '2026-09-18T14:27:00Z' };
    const current = run({ log: [{ at: 'x', step_id: 'antes', type: 'send_text', note: 'já rodou' }] });
    const tables = db(bot(steps), [current as unknown as Row, other as unknown as Row]);
    await processBotRun(fakeDb(tables), current);
    expect(tables.wa_bot_runs.find(r => r.id === 'run-1')!.status).toBe('done');
    expect(tables.wa_bot_runs.find(r => r.id === 'run-2')).toMatchObject({ status: 'cancelled', wake_at: null });
  });

  it('execução nova na conversa cancela a anterior (o mais novo vence)', async () => {
    const steps = chain([{ id: 'tx', type: 'send_text', text: 'Oi' }]);
    const older = run({ id: 'run-old', status: 'waiting_reply' });
    const tables = db(bot(steps), [older as unknown as Row, run() as unknown as Row]);
    await processBotRun(fakeDb(tables), run());
    expect(tables.wa_bot_runs.find(r => r.id === 'run-old')!.status).toBe('cancelled');
  });

  it('não fala em conversa de número que o robô não atende', async () => {
    const steps = chain([{ id: 'tx', type: 'send_text', text: 'Oi' }]);
    const tables = db(bot(steps, { connection_ids: ['conn-b'], connection_id: 'conn-b' }), [run()]);
    await processBotRun(fakeDb(tables), run());
    expect(h.sent).toEqual([]);
    expect(tables.wa_bot_runs[0].status).toBe('error');
  });

  it('robô sem número configurado não atua em nenhum número', async () => {
    const steps = chain([{ id: 'tx', type: 'send_text', text: 'Oi' }]);
    const tables = db(bot(steps, { connection_ids: [], connection_id: null }), [run()]);
    await processBotRun(fakeDb(tables), run());
    expect(h.sent).toEqual([]);
  });

  it('retoma pelo id do passo mesmo depois de o quadro ser reordenado', async () => {
    // A execução parou esperando resposta antes do passo "depois", que era o índice 1;
    // o robô foi editado e "depois" virou o índice 2.
    const steps = chain([
      { id: 'inicio', type: 'send_text', text: 'Início' },
      { id: 'novo', type: 'send_text', text: 'Bloco novo' },
      { id: 'depois', type: 'send_text', text: 'Continuação' },
    ]);
    const parked = run({
      step_index: 1,
      vars: { _resume_step_id: 'depois' },
      log: [{ at: 'x', step_id: 'inicio', type: 'wait_reply', note: 'esperando' }],
    });
    const tables = db(bot(steps), [parked as unknown as Row]);
    await processBotRun(fakeDb(tables), parked);
    expect(h.sent).toEqual(['Continuação']);
  });

  it('digitação não soma o tempo da Evolution com a espera', async () => {
    const steps = chain([
      { id: 'dg', type: 'typing', seconds: 1 },
      { id: 'tx', type: 'send_text', text: 'Oi' },
    ]);
    const tables = db(bot(steps), [run()]);
    const service = await import('@/lib/whatsapp');
    // Evolution segura a chamada pelo tempo do "digitando"
    const spy = vi.spyOn(service, 'getProvider').mockReturnValue({
      sendText: async ({ text }: { text: string }) => (h.sent.push(text), { ok: true }),
      sendTyping: async ({ ms }: { ms: number }) => new Promise<void>(r => setTimeout(r, ms)),
    } as never);
    const t0 = Date.now();
    await processBotRun(fakeDb(tables), run());
    spy.mockRestore();
    const elapsed = Date.now() - t0;
    expect(h.sent).toEqual(['Oi']);
    expect(elapsed).toBeLessThan(1800);
  });

  it('remove tag (sem erro quando o lead não tem), cria lead e segue usando o lead novo', async () => {
    h.deal = null;
    const steps = chain([
      { id: 'rm', type: 'remove_tag', tag: 'nao-tem' },
      { id: 'cr', type: 'create_lead', board_id: '00000000-0000-4000-8000-00000000000b', stage_id: '00000000-0000-4000-8000-00000000000c', changes: [] },
      { id: 'rm2', type: 'remove_tag', tag: 'tem' },
      { id: 'tg', type: 'add_tag', tag: 'novo' },
      { id: 'up', type: 'update_lead', changes: [{ field: 'description', mode: 'append', value: 'Contato {{nome}}' }] },
    ]);
    const tables = db(bot(steps), [run()]);
    await processBotRun(fakeDb(tables), run());
    const saved = tables.wa_bot_runs[0];
    // antes de existir lead, remover tag é pulado (visível); depois, tudo roda no lead criado
    expect((saved.log as Array<{ step_id: string; status?: string }>).find((e) => e.step_id === 'rm')?.status).toBe('skipped');
    expect(h.created).toHaveLength(1);
    expect(h.removed).toEqual(['tem']);
    expect(h.tags).toEqual([{ dealId: 'deal-new', tag: 'novo' }]);
    expect(h.updated[0].rendered).toEqual(['Contato Maria Souza']);
    expect(saved.deal_id).toBe('deal-new');
    expect(saved.status).toBe('done');
  });

  it('mover para etapa de perda leva motivo (com variável) e classificação, e registra no histórico', async () => {
    const steps = chain([
      {
        id: 'mv',
        type: 'move_stage',
        stage_id: '00000000-0000-4000-8000-000000000009',
        loss_reason: 'Sem retorno de {{primeiro_nome}}',
        loss_category: 'disqualified',
      },
    ]);
    const tables = db(bot(steps), [run()]);
    await processBotRun(fakeDb(tables), run());
    expect(h.moveOpts[0]).toMatchObject({ lossReason: 'Sem retorno de Maria', lossCategory: 'disqualified' });
    expect(h.lossHistory).toBe(1);
  });

  it('digitando dentro da mensagem acontece antes de enviar', async () => {
    const order: string[] = [];
    const steps = chain([{ id: 'tx', type: 'send_text', text: 'Oi', typing_seconds: 1 }]);
    const tables = db(bot(steps), [run()]);
    const service = await import('@/lib/whatsapp');
    const spy = vi.spyOn(service, 'getProvider').mockReturnValue({
      sendText: async ({ text }: { text: string }) => (order.push(`envio:${text}`), { ok: true }),
      sendTyping: async ({ ms }: { ms: number }) => {
        order.push(`digitando:${ms}`);
      },
    } as never);
    const t0 = Date.now();
    await processBotRun(fakeDb(tables), run());
    spy.mockRestore();
    expect(order).toEqual(['digitando:1000', 'envio:Oi']);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
  });

  it('esperar resposta usa o prazo em segundos quando configurado', async () => {
    const steps = chain([{ id: 'wr', type: 'wait_reply', timeout_minutes: 1, timeout_seconds: 45 }]);
    const tables = db(bot(steps), [run()]);
    const before = Date.now();
    await processBotRun(fakeDb(tables), run());
    const saved = tables.wa_bot_runs[0];
    expect(saved.status).toBe('waiting_reply');
    const wait = new Date(String(saved.wake_at)).getTime() - before;
    expect(wait).toBeGreaterThanOrEqual(44000);
    expect(wait).toBeLessThan(47000);
  });
});
