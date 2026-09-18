/**
 * Execução do follow-up por inatividade com banco e WhatsApp FALSOS: nada é
 * enviado de verdade. Confere as rechecagens antes de agir e o resultado real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  started: [] as Array<Record<string, unknown>>,
  texts: [] as string[],
  templates: [] as string[],
  startOk: true,
}));

vi.mock('./bots', () => ({
  startBotRun: async (_a: unknown, input: Record<string, unknown>) => {
    h.started.push(input);
    return h.startOk ? { ok: true, runId: 'run-1' } : { ok: false, error: 'Robô desligado' };
  },
  sendTextToConversation: async (_a: unknown, i: { text: string }) => {
    h.texts.push(i.text);
  },
  sendTemplateToConversation: async (_a: unknown, i: { templateId: string }) => {
    h.templates.push(i.templateId);
    return 'Modelo X';
  },
}));
vi.mock('@/lib/whatsapp/service', () => ({
  getConnectionByIdForOrg: async (_a: unknown, _o: string, id: string) =>
    id === 'conn-meta' ? { id, status: 'connected', provider: 'meta_cloud' } : { id, status: 'connected', provider: 'evolution' },
}));
vi.mock('./context', () => ({ loadDealContext: async () => ({ title: 'Lead Maria', stage_label: 'Em qualificação' }) }));

import { runStageFollowup, type FollowupSchedule } from './stageFollowups';

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let single = false;
    let head = false;
    let limit: number | null = null;
    let orderCol: string | null = null;
    let asc = true;
    const b: Record<string, unknown> = {
      select: (_c?: string, opts?: { head?: boolean }) => ((head = !!opts?.head), b),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
      or: (expr: string) => {
        const parts = expr.split(',').map((p) => p.split('.eq.'));
        filters.push((r) => parts.some(([c, v]) => String(r[c]) === v));
        return b;
      },
      order: (c: string, o?: { ascending?: boolean }) => ((orderCol = c), (asc = o?.ascending !== false), b),
      limit: (n: number) => ((limit = n), b),
      maybeSingle: () => ((single = true), b),
      then: (resolve: (v: unknown) => void) => {
        let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        if (orderCol) rows = [...rows].sort((x, y) => (String(x[orderCol!]) < String(y[orderCol!]) ? -1 : 1) * (asc ? 1 : -1));
        if (limit !== null) rows = rows.slice(0, limit);
        if (head) return resolve({ count: rows.length, data: null, error: null });
        resolve({ data: single ? rows[0] ?? null : rows, error: null });
      },
    };
    return b;
  };
  return { from } as never;
}

const ORG = 'org';
const T0 = '2026-09-18T10:00:00.000Z';
const sched: FollowupSchedule = {
  deal_id: 'deal-1',
  organization_id: ORG,
  stage_id: 'stage-1',
  rule_version: 1,
  entered_at: T0,
  anchor_at: '2026-09-18T11:00:00.000Z',
  due_at: '2026-09-18T13:00:00.000Z',
  status: 'processing',
  attempts: 1,
};

function base(over: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  return {
    stage_followup_rules: [
      { stage_id: 'stage-1', organization_id: ORG, enabled: true, delay_seconds: 7200, action_type: 'message', bot_id: null, message: { kind: 'text', text: 'Oi {{primeiro_nome}}, ainda tem interesse?' }, version: 1 },
    ],
    deals: [{ id: 'deal-1', organization_id: ORG, stage_id: 'stage-1', contact_id: 'c1', is_won: false, is_lost: false, deleted_at: null }],
    wa_conversations: [
      { id: 'conv-1', organization_id: ORG, connection_id: 'conn-qr', wa_phone: '+5511988887777', deal_id: 'deal-1', contact_id: 'c1', last_message_at: T0, is_group: false },
    ],
    wa_messages: [{ conversation_id: 'conv-1', direction: 'in', created_at: '2026-09-18T11:00:00.000Z' }],
    contacts: [{ id: 'c1', name: 'Maria Souza' }],
    wa_bot_runs: [],
    ...over,
  } as Record<string, Row[]>;
}

beforeEach(() => {
  h.started = [];
  h.texts = [];
  h.templates = [];
  h.startOk = true;
});

describe('follow-up por inatividade: execução', () => {
  it('envia a mensagem na conversa do lead, com as variáveis preenchidas', async () => {
    const r = await runStageFollowup(fakeDb(base()), sched);
    expect(r.status).toBe('done');
    expect(h.texts).toEqual(['Oi Maria, ainda tem interesse?']);
  });

  it('lead respondeu depois do início da contagem: não age (o banco já reagendou)', async () => {
    const t = base({ wa_messages: [{ conversation_id: 'conv-1', direction: 'in', created_at: '2026-09-18T12:59:00.000Z' }] });
    const r = await runStageFollowup(fakeDb(t), sched);
    expect(r.status).toBe('superseded');
    expect(h.texts).toEqual([]);
  });

  it('mensagem do atendente depois do início não conta como resposta do lead', async () => {
    const t = base({
      wa_messages: [
        { conversation_id: 'conv-1', direction: 'in', created_at: '2026-09-18T11:00:00.000Z' },
        { conversation_id: 'conv-1', direction: 'out', created_at: '2026-09-18T12:00:00.000Z' },
      ],
    });
    expect((await runStageFollowup(fakeDb(t), sched)).status).toBe('done');
  });

  it('lead mudou de etapa, ganhou ou regra desligada: cancela sem enviar', async () => {
    expect((await runStageFollowup(fakeDb(base({ deals: [{ ...base().deals[0], stage_id: 'outra' }] })), sched)).status).toBe('cancelled');
    expect((await runStageFollowup(fakeDb(base({ deals: [{ ...base().deals[0], is_won: true }] })), sched)).status).toBe('cancelled');
    expect(
      (await runStageFollowup(fakeDb(base({ stage_followup_rules: [{ ...base().stage_followup_rules[0], enabled: false }] })), sched)).status
    ).toBe('cancelled');
    expect(h.texts).toEqual([]);
  });

  it('já executou nesta etapa para este lead: não executa de novo', async () => {
    const t = base({ deal_followup_fires: [{ deal_id: 'deal-1', stage_id: 'stage-1' }] });
    expect((await runStageFollowup(fakeDb(t), sched)).status).toBe('cancelled');
    expect(h.texts).toEqual([]);
  });

  it('API oficial fora da janela de 24 h: falha explicando que precisa de modelo', async () => {
    const t = base({
      wa_conversations: [{ ...base().wa_conversations[0], connection_id: 'conn-meta' }],
      wa_messages: [{ conversation_id: 'conv-1', direction: 'in', created_at: '2026-09-10T11:00:00.000Z' }],
    });
    const r = await runStageFollowup(fakeDb(t), { ...sched, anchor_at: '2026-09-10T11:00:00.000Z' });
    expect(r).toMatchObject({ status: 'failed' });
    expect(JSON.stringify(r)).toContain('24 h');
    expect(h.texts).toEqual([]);
  });

  it('modelo aprovado é enviado como modelo', async () => {
    const t = base({
      stage_followup_rules: [{ ...base().stage_followup_rules[0], message: { kind: 'template', template_id: 'tpl-1' } }],
    });
    expect((await runStageFollowup(fakeDb(t), sched)).status).toBe('done');
    expect(h.templates).toEqual(['tpl-1']);
  });

  it('contato com outro lead aberto e sem conversa ligada a este: não escolhe no chute', async () => {
    const t = base({
      wa_conversations: [{ ...base().wa_conversations[0], deal_id: 'deal-OUTRO' }],
      deals: [...base().deals, { id: 'deal-OUTRO', organization_id: ORG, stage_id: 'x', contact_id: 'c1', is_won: false, is_lost: false, deleted_at: null }],
    });
    const r = await runStageFollowup(fakeDb(t), sched);
    expect(r.status).toBe('skipped');
    expect(h.texts).toEqual([]);
  });

  it('robô: inicia no lead e na conversa certos', async () => {
    const t = base({ stage_followup_rules: [{ ...base().stage_followup_rules[0], action_type: 'bot', bot_id: 'bot-1' }] });
    const r = await runStageFollowup(fakeDb(t), sched);
    expect(r).toMatchObject({ status: 'done', result: { kind: 'bot_started', run_id: 'run-1' } });
    expect(h.started[0]).toMatchObject({ botId: 'bot-1', dealId: 'deal-1', conversationId: 'conv-1' });
  });

  it('robô já rodando neste lead: não abre outra instância', async () => {
    const t = base({
      stage_followup_rules: [{ ...base().stage_followup_rules[0], action_type: 'bot', bot_id: 'bot-1' }],
      wa_bot_runs: [{ id: 'r0', organization_id: ORG, bot_id: 'bot-1', status: 'waiting_reply', deal_id: 'deal-1', conversation_id: 'conv-1' }],
    });
    expect((await runStageFollowup(fakeDb(t), sched)).status).toBe('skipped');
    expect(h.started).toEqual([]);
  });

  it('robô que não inicia vira falha (não "executado")', async () => {
    h.startOk = false;
    const t = base({ stage_followup_rules: [{ ...base().stage_followup_rules[0], action_type: 'bot', bot_id: 'bot-1' }] });
    expect(await runStageFollowup(fakeDb(t), sched)).toMatchObject({ status: 'failed', error: 'Robô desligado' });
  });
});
