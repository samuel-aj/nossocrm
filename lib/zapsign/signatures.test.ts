/**
 * Envio para assinatura e retorno da ZapSign com banco, WhatsApp e ZapSign
 * FALSOS: nada sai de verdade. Confere as rechecagens, o que é gravado no lead
 * e a idempotência do webhook.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  texts: [] as string[],
  created: [] as Array<Record<string, unknown>>,
  signerPatches: [] as Array<Record<string, unknown>>,
  addedSigners: [] as Array<Record<string, unknown>>,
  botsStarted: [] as Array<Record<string, unknown>>,
  failCreate: null as null | { status: number; message: string },
  downloaded: [] as string[],
}));

vi.mock('@/lib/wa-agents/bots', () => ({
  sendTextToConversation: async (_a: unknown, i: { text: string }) => {
    h.texts.push(i.text);
  },
  startBotRun: async (_a: unknown, input: Record<string, unknown>) => {
    h.botsStarted.push(input);
    return { ok: true, runId: 'run-1' };
  },
}));
vi.mock('@/lib/whatsapp/service', () => ({
  getConnectionByIdForOrg: async (_a: unknown, _o: string, id: string) => ({ id, status: 'connected', provider: id === 'conn-meta' ? 'meta_cloud' : 'evolution' }),
}));
vi.mock('@/lib/wa-agents/context', () => ({
  loadDealContext: async () => ({
    title: 'Aposentadoria',
    value: 4500,
    items: [{ product_id: null, name: 'Consulta', quantity: 1, price: 300 }],
    stage_label: 'Fechamento',
    board_name: 'Previdenciário',
    owner_name: 'Ana Lab',
    description: '',
    custom_fields: { cpf: '123.456.789-00' },
    custom_field_labels: { cpf: 'CPF' },
  }),
}));
vi.mock('@/lib/wa-agents/leadOps', () => ({
  loadCustomFieldDefs: async () => [{ key: 'cpf', label: 'CPF', type: 'text', options: [] }],
}));

import { createManualSignature, handleZapSignWebhook, sendSignature, type SignatureRow } from './signatures';
import type { ZapSignClient } from './client';

type Row = Record<string, unknown>;

/** Banco falso com o mínimo que o serviço usa (filtros, update, insert, count, storage). */
function fakeDb(tables: Record<string, Row[]>) {
  const storage = { uploads: [] as Array<{ bucket: string; path: string; bytes: number }> };
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let single = false;
    let head = false;
    let limit: number | null = null;
    let order: { col: string; asc: boolean } | null = null;
    let op: 'select' | 'update' | 'insert' = 'select';
    let payload: Row | Row[] | null = null;
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
      order: (c: string, o?: { ascending?: boolean }) => ((order = { col: c, asc: o?.ascending !== false }), b),
      limit: (n: number) => ((limit = n), b),
      maybeSingle: () => ((single = true), b),
      single: () => ((single = true), b),
      update: (p: Row) => ((op = 'update'), (payload = p), b),
      insert: (p: Row | Row[]) => ((op = 'insert'), (payload = p), b),
      then: (resolve: (v: unknown) => void) => {
        tables[table] ??= [];
        if (op === 'insert') {
          const list = Array.isArray(payload) ? payload : [payload as Row];
          const inserted = list.map((p) => ({ id: `${table}-${tables[table].length + 1}`, created_at: new Date().toISOString(), ...p }));
          tables[table].push(...inserted);
          return resolve({ data: single ? inserted[0] : inserted, error: null });
        }
        let rows = tables[table].filter((r) => filters.every((f) => f(r)));
        if (op === 'update') {
          for (const r of rows) Object.assign(r, payload);
          return resolve({ data: single ? rows[0] ?? null : rows, error: null });
        }
        if (order) rows = [...rows].sort((x, y) => (String(x[order!.col]) < String(y[order!.col]) ? -1 : 1) * (order!.asc ? 1 : -1));
        if (limit !== null) rows = rows.slice(0, limit);
        if (head) return resolve({ count: rows.length, data: null, error: null });
        resolve({ data: single ? rows[0] ?? null : rows, error: null });
      },
    };
    return b;
  };
  const admin = {
    from,
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, bytes: Uint8Array) => {
          storage.uploads.push({ bucket, path, bytes: bytes.byteLength });
          return { error: null };
        },
      }),
    },
  };
  return { admin: admin as never, tables, storage };
}

function fakeClient(): ZapSignClient {
  return {
    createDocFromTemplate: async (input: Record<string, unknown>) => {
      h.created.push(input);
      if (h.failCreate) {
        const { ZapSignError } = await import('./client');
        throw new ZapSignError(h.failCreate.message, h.failCreate.status);
      }
      return {
        token: 'doc-1',
        name: input.name,
        status: 'pending',
        signers: [{ token: 'sig-1', sign_url: 'https://app.zapsign.com.br/verificar/sig-1', status: 'new', name: input.signer_name, email: input.signer_email ?? null, phone_country: '55', phone_number: '11988887777' }],
      };
    },
    updateSigner: async (_t: string, patch: Record<string, unknown>) => (h.signerPatches.push(patch), { token: 'sig-1', status: 'new', name: 'x' }),
    addSigner: async (_d: string, s: Record<string, unknown>) => (h.addedSigners.push(s), { token: `sig-${h.addedSigners.length + 1}`, status: 'new', name: String(s.name), sign_url: 'https://app.zapsign.com.br/verificar/sig-x' }),
    download: async (url: string) => (h.downloaded.push(url), { bytes: new Uint8Array([37, 80, 68, 70]), contentType: 'application/pdf' }),
  } as unknown as ZapSignClient;
}

const ORG = 'org-1';
const RULE = {
  stage_id: 'stage-1',
  organization_id: ORG,
  enabled: true,
  template_token: 'tpl-1',
  template_name: 'Contrato de honorários',
  doc_name: null,
  variables: { NOME: 'contato.nome', CPF: 'campo:cpf', VALOR: 'negocio.valor', FORO: 'texto:São Paulo' },
  signer: { send: 'crm_whatsapp', auth_mode: 'tokenWhatsapp', require_cpf: true, message: 'Oi {{primeiro_nome}}, assine: {{link}}' },
  extra_signers: [{ name: 'Dr. Carlos', email: 'carlos@escritorio.com', qualification: 'Advogado' }],
  on_signed: { stage_id: 'stage-2', tag: 'contrato assinado', bot_id: 'bot-1' },
  on_refused: { stage_id: null, tag: 'recusou contrato' },
  version: 1,
};

function base(over: Partial<Record<string, Row[]>> = {}) {
  return fakeDb({
    zapsign_settings: [{ organization_id: ORG, api_token: 'tok', sandbox: true, webhook_secret: 'zs_x', webhook_id: '1' }],
    stage_signature_rules: [RULE],
    deals: [{ id: 'deal-1', organization_id: ORG, title: 'Aposentadoria', stage_id: 'stage-1', contact_id: 'c1', is_won: false, is_lost: false, deleted_at: null, tags: [] }],
    contacts: [{ id: 'c1', name: 'Maria da Silva', email: 'maria@exemplo.com', phone: '+5511988887777', company_name: null }],
    organizations: [{ id: ORG, name: 'Escritório Teste' }],
    wa_conversations: [{ id: 'conv-1', organization_id: ORG, connection_id: 'conn-qr', wa_phone: '+5511988887777', deal_id: 'deal-1', contact_id: 'c1', last_message_at: '2026-10-27T10:00:00Z', is_group: false }],
    wa_messages: [{ conversation_id: 'conv-1', direction: 'in', created_at: '2026-10-27T10:00:00Z' }],
    board_stages: [{ id: 'stage-2', organization_id: ORG, board_id: 'b1' }],
    deal_signatures: [],
    deal_events: [],
    deal_files: [],
    ...over,
  });
}

const queued = (): SignatureRow => ({
  id: 'sigrow-1',
  organization_id: ORG,
  deal_id: 'deal-1',
  contact_id: 'c1',
  stage_id: 'stage-1',
  origin: 'rule',
  requested_by: null,
  template_token: null,
  template_name: null,
  doc_token: null,
  doc_name: null,
  status: 'processing',
  attempts: 1,
  request: null,
  signers: [],
  sign_url: null,
  sent_via: null,
  sent_at: null,
  signed_at: null,
  refused_at: null,
  refused_reason: null,
  file_id: null,
  file_path: null,
  last_error: null,
  created_at: '2026-10-27T10:00:00Z',
});

beforeEach(() => {
  h.texts = [];
  h.created = [];
  h.signerPatches = [];
  h.addedSigners = [];
  h.botsStarted = [];
  h.failCreate = null;
  h.downloaded = [];
});

describe('envio para assinatura (regra da etapa)', () => {
  it('cria o documento com as variáveis do lead e manda o link pelo WhatsApp do CRM', async () => {
    const db = base();
    db.tables.deal_signatures.push(queued() as unknown as Row);
    const out = await sendSignature(db.admin, queued(), { client: fakeClient() });
    expect(out).toMatchObject({ status: 'pending', sent_via: 'crm_whatsapp' });
    const req = h.created[0];
    expect(req.template_id).toBe('tpl-1');
    expect(req.signer_name).toBe('Maria da Silva');
    expect(req.signer_phone_country).toBe('55');
    expect(req.signer_phone_number).toBe('11988887777');
    expect(req.external_id).toBe('sigrow-1');
    expect(req.send_automatic_whatsapp).toBe(false);
    expect(req.data).toEqual(
      expect.arrayContaining([
        { de: '{{NOME}}', para: 'Maria da Silva' },
        { de: '{{CPF}}', para: '123.456.789-00' },
        { de: '{{FORO}}', para: 'São Paulo' },
      ])
    );
    expect((req.data as Array<{ de: string; para: string }>).find((d) => d.de === '{{VALOR}}')?.para).toMatch(/4\.500,00/);
    // exigências do signatário e o segundo signatário
    expect(h.signerPatches[0]).toMatchObject({ auth_mode: 'tokenWhatsapp', require_cpf: true });
    expect(h.addedSigners[0]).toMatchObject({ name: 'Dr. Carlos', qualification: 'Advogado', send_automatic_email: true });
    // link na conversa, com a mensagem da regra
    expect(h.texts).toEqual(['Oi Maria, assine: https://app.zapsign.com.br/verificar/sig-1']);
    const row = db.tables.deal_signatures[0];
    expect(row.doc_token).toBe('doc-1');
    expect(row.sign_url).toBe('https://app.zapsign.com.br/verificar/sig-1');
  });

  it('lead mudou de etapa, ganhou ou a regra foi desligada antes do envio: cancela sem criar documento', async () => {
    for (const over of [
      { deals: [{ ...base().tables.deals[0], stage_id: 'outra' }] },
      { deals: [{ ...base().tables.deals[0], is_won: true }] },
      { stage_signature_rules: [{ ...RULE, enabled: false }] },
    ]) {
      const db = base(over as Partial<Record<string, Row[]>>);
      expect((await sendSignature(db.admin, queued(), { client: fakeClient() })).status).toBe('cancelled');
    }
    expect(h.created).toEqual([]);
  });

  it('sem conversa no WhatsApp: o documento é criado e o link fica no lead', async () => {
    const db = base({ wa_conversations: [], wa_messages: [] });
    db.tables.deal_signatures.push(queued() as unknown as Row);
    const out = await sendSignature(db.admin, queued(), { client: fakeClient() });
    expect(out).toMatchObject({ status: 'pending', sent_via: 'link' });
    expect(String((out as { note?: string }).note)).toContain('conversa');
    expect(h.texts).toEqual([]);
  });

  it('API oficial com janela de 24 h fechada: cria o documento, mas não manda texto livre', async () => {
    const db = base({
      wa_conversations: [{ ...base().tables.wa_conversations[0], connection_id: 'conn-meta' }],
      wa_messages: [{ conversation_id: 'conv-1', direction: 'in', created_at: '2026-10-01T10:00:00Z' }],
    });
    db.tables.deal_signatures.push(queued() as unknown as Row);
    const out = await sendSignature(db.admin, queued(), { client: fakeClient() });
    expect(out).toMatchObject({ status: 'pending', sent_via: 'link' });
    expect(h.texts).toEqual([]);
  });

  it('token recusado pela ZapSign: falha sem repetir; ZapSign fora do ar: falha com nova tentativa', async () => {
    h.failCreate = { status: 403, message: 'token' };
    expect(await sendSignature(base().admin, queued(), { client: fakeClient() })).toMatchObject({ status: 'failed', retry: false });
    h.failCreate = { status: 503, message: 'down' };
    expect(await sendSignature(base().admin, queued(), { client: fakeClient() })).toMatchObject({ status: 'failed', retry: true });
  });
});

describe('envio manual pela tela do lead', () => {
  it('grava a linha, cria o documento com os valores editados e registra no histórico', async () => {
    const db = base();
    const { row, outcome } = await createManualSignature(db.admin, {
      organizationId: ORG,
      dealId: 'deal-1',
      userId: 'u1',
      request: { template_token: 'tpl-1', template_name: 'Contrato', variables: { NOME: 'contato.nome' }, overrides: { NOME: 'Maria S.' }, signer: { send: 'link' } },
      deps: { client: fakeClient() },
    });
    expect(outcome).toMatchObject({ status: 'pending', sent_via: 'link' });
    expect(row.origin).toBe('manual');
    expect(row.status).toBe('pending');
    expect(h.created[0].data).toEqual([{ de: '{{NOME}}', para: 'Maria S.' }]);
    expect(h.texts).toEqual([]);
    expect(db.tables.deal_events.map((e) => [e.kind, e.new_value])).toEqual([['signature', 'sent']]);
  });
});

describe('retorno da ZapSign (webhook)', () => {
  function withPending() {
    const db = base();
    db.tables.deal_signatures.push({
      ...queued(),
      status: 'pending',
      doc_token: 'doc-1',
      doc_name: 'Contrato - Maria',
      request: { template_token: 'tpl-1', variables: {}, signer: {}, on_signed: RULE.on_signed, on_refused: RULE.on_refused },
      signers: [{ token: 'sig-1', name: 'Maria da Silva', email: null, phone: null, sign_url: null, status: 'new', signed_at: null, role: 'contact' }],
    } as unknown as Row);
    return db;
  }
  const signedPayload = {
    event_type: 'doc_signed',
    token: 'doc-1',
    status: 'signed',
    signed_file: 'https://zapsign.example/signed.pdf',
    last_update_at: '2026-10-27T12:00:00Z',
    signers: [{ token: 'sig-1', name: 'Maria da Silva', status: 'signed', signed_at: '2026-10-27T12:00:00Z' }],
    signer_who_signed: { token: 'sig-1', name: 'Maria da Silva', status: 'signed' },
  };

  it('assinado: guarda o PDF nos anexos, registra no histórico, move a etapa, etiqueta e inicia o robô', async () => {
    const db = withPending();
    const r = await handleZapSignWebhook(db.admin, ORG, signedPayload, { client: fakeClient() });
    expect(r.action).toBe('signed');
    const row = db.tables.deal_signatures[0];
    expect(row.status).toBe('signed');
    expect(db.storage.uploads[0]).toMatchObject({ bucket: 'deal-files', path: 'deal-1/zapsign-doc-1.pdf' });
    expect(db.tables.deal_files[0]).toMatchObject({ deal_id: 'deal-1', mime_type: 'application/pdf' });
    expect(row.file_id).toBe(db.tables.deal_files[0].id);
    expect(db.tables.deal_events.map((e) => e.new_value)).toEqual(['signed']);
    expect(db.tables.deals[0]).toMatchObject({ stage_id: 'stage-2', tags: ['contrato assinado'] });
    expect(h.botsStarted[0]).toMatchObject({ botId: 'bot-1', dealId: 'deal-1', conversationId: 'conv-1' });
  });

  it('o mesmo evento repetido não duplica arquivo, histórico nem ações', async () => {
    const db = withPending();
    await handleZapSignWebhook(db.admin, ORG, signedPayload, { client: fakeClient() });
    const r = await handleZapSignWebhook(db.admin, ORG, signedPayload, { client: fakeClient() });
    expect(r.action).toBe('already_signed');
    expect(db.storage.uploads).toHaveLength(1);
    expect(db.tables.deal_events).toHaveLength(1);
    expect(h.botsStarted).toHaveLength(1);
  });

  it('um signatário assinou e faltam outros: fica aguardando', async () => {
    const db = withPending();
    const r = await handleZapSignWebhook(db.admin, ORG, { ...signedPayload, status: 'pending' }, { client: fakeClient() });
    expect(r.action).toBe('partially_signed');
    expect(db.tables.deal_signatures[0].status).toBe('pending');
    expect(db.storage.uploads).toHaveLength(0);
  });

  it('recusado: registra o motivo e aplica a etiqueta de recusa', async () => {
    const db = withPending();
    const r = await handleZapSignWebhook(db.admin, ORG, { event_type: 'doc_refused', token: 'doc-1', status: 'refused', rejected_reason: 'Valor alto' }, { client: fakeClient() });
    expect(r.action).toBe('refused');
    expect(db.tables.deal_signatures[0]).toMatchObject({ status: 'refused', refused_reason: 'Valor alto' });
    expect(db.tables.deals[0]).toMatchObject({ stage_id: 'stage-1', tags: ['recusou contrato'] });
    expect(db.tables.deal_events[0]).toMatchObject({ new_value: 'refused' });
  });

  it('documento desconhecido (criado fora do CRM): ignora', async () => {
    const db = withPending();
    expect((await handleZapSignWebhook(db.admin, ORG, { event_type: 'doc_signed', token: 'outro', status: 'signed' })).action).toBe('ignored_unknown_doc');
  });
});
