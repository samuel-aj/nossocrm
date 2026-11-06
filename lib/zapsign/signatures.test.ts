/**
 * Envio para assinatura e retorno da ZapSign com banco, WhatsApp e ZapSign
 * FALSOS: nada sai de verdade. Confere as rechecagens, o que é gravado no lead
 * e a idempotência do webhook.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { createManualSignature, discardSignature, handleZapSignWebhook, sendSignature, type SignatureRow } from './signatures';
import { ZapSignClient } from './client';
import { runAgentContract } from './agentContract';
import { simulateAgentContract } from './agentSimulation';
import * as files from './templateFile';
import * as budgets from '@/lib/ai-usage/budget';

type Row = Record<string, unknown>;

/** Banco falso com o mínimo que o serviço usa (filtros, update, insert, count, storage). */
function fakeDb(tables: Record<string, Row[]>) {
  const storage = { uploads: [] as Array<{ bucket: string; path: string; bytes: number }> };
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let single = false;
    let head = false;
    let limit: number | null = null;
    const orders: { col: string; asc: boolean }[] = [];
    let op: 'select' | 'update' | 'insert' = 'select';
    let payload: Row | Row[] | null = null;
    const b: Record<string, unknown> = {
      select: (_c?: string, opts?: { head?: boolean }) => ((head = !!opts?.head), b),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      gte: (c: string, v: string) => (filters.push(r => String(r[c]) >= v), b),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
      or: (expr: string) => {
        if (expr.startsWith('origin.eq.agent,status.in.')) {
          const states = expr.slice(expr.indexOf('(') + 1, -1).split(',');
          filters.push(r => r.origin === 'agent' || states.includes(String(r.status)));
          return b;
        }
        const parts = expr.split(',').map((p) => p.split('.eq.'));
        filters.push((r) => parts.some(([c, v]) => String(r[c]) === v));
        return b;
      },
      order: (c: string, o?: { ascending?: boolean }) => (orders.push({ col: c, asc: o?.ascending !== false }), b),
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
          if (table === 'deal_signatures' && list.some(p => p.origin === 'agent' && tables[table].some(r =>
            r.origin === 'agent' && r.organization_id === p.organization_id && r.deal_id === p.deal_id && r.template_token === p.template_token)))
            return resolve({ data: null, error: { code: '23505' } });
          tables[table].push(...inserted);
          return resolve({ data: single ? inserted[0] : inserted, error: null });
        }
        let rows = tables[table].filter((r) => filters.every((f) => f(r)));
        if (op === 'update') {
          for (const r of rows) Object.assign(r, payload);
          return resolve({ data: single ? rows[0] ?? null : rows, error: null });
        }
        for (const order of [...orders].reverse()) rows = [...rows].sort((x, y) => String(x[order.col]).localeCompare(String(y[order.col])) * (order.asc ? 1 : -1));
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
    listTemplates: async () => [{ token: 'tpl-1', name: 'Honorários' }],
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
    contacts: [{ id: 'c1', organization_id: ORG, name: 'Maria da Silva', email: 'maria@exemplo.com', phone: '+5511988887777', company_name: null }],
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

  it('mensagem da regra sem {{link}}: o link vai numa linha no final', async () => {
    const db = base();
    db.tables.stage_signature_rules[0] = { ...RULE, signer: { ...RULE.signer, message: 'Oi {{primeiro_nome}}, segue o contrato.' } } as unknown as Row;
    db.tables.deal_signatures.push(queued() as unknown as Row);
    const out = await sendSignature(db.admin, queued(), { client: fakeClient() });
    expect(out).toMatchObject({ status: 'pending', sent_via: 'crm_whatsapp' });
    expect(h.texts).toEqual(['Oi Maria, segue o contrato.\n\nhttps://app.zapsign.com.br/verificar/sig-1']);
  });
  it('um modelo composto só libera o convite da ZapSign depois de confirmar os anexos', async () => {
    const db = base(), client = fakeClient();
    db.tables.stage_signature_rules[0] = {...RULE,signer:{send:'zapsign_email'},extra_signers:[]} as unknown as Row;
    db.tables.deal_signatures.push(queued() as unknown as Row);
    client.listTemplates = async () => [{token:'tpl-1',name:'Contrato',extra_templates:[{token:'child',name:'Procuração.docx'}]}];
    client.getDoc = vi.fn().mockResolvedValue({token:'doc-1',name:'Contrato',status:'pending',extra_docs:[{token:'extra',name:'Procuração.pdf'}],
      signers:[{token:'office',name:'Testemunha',status:'new'},{token:'sig-1',name:'Maria da Silva',status:'new'}]});
    expect(await sendSignature(db.admin,queued(),{client})).toMatchObject({status:'pending',sent_via:'zapsign_email'});
    expect(h.created).toHaveLength(1);
    expect(h.created[0]).toMatchObject({send_automatic_email:false,send_automatic_whatsapp:false});
    expect(h.signerPatches).toEqual([{send_automatic_email:true,send_automatic_whatsapp:false}]);
    expect(db.tables.deal_signatures[0].sign_url).toBe('https://app.zapsign.com.br/verificar/sig-1');
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

describe('criação pelo agente com ZapSign e conversa simuladas', () => {
  const scope = { org: ORG, agent: 'agent', conversation: 'conv-1', deal: 'deal-1',
    template: 'tpl-1', inboundId: '1', since: '2000-01-01T00:00:00Z' };
  const prepare = { modo: 'preparar' as const, dados: { ENDEREÇO: 'Rua das Flores' } };
  const create = { ...prepare, modo: 'criar' as const };
  const msg = (id: string, direction: string, body: string, sec: number, status = 'sent') => ({
    organization_id: ORG, conversation_id: scope.conversation, id, direction, body, source: direction === 'out' ? 'agent' : 'customer', status,
    created_at: new Date(Date.now() - 5000 + sec * 1000).toISOString(),
  });
  function setup() {
    const db = base({ wa_messages: [msg('1', 'in', 'Meu endereço é Rua das Flores', 0)],
      wa_ai_agents: [{ id: scope.agent, organization_id: ORG, enabled: true, tools: { zapsign_template_token: 'tpl-1' } }] });
    Object.assign(db.tables.wa_conversations[0], { ai_status: 'active', ai_agent_id: scope.agent });
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Rede proibida'); }));
    vi.spyOn(files, 'readContractTemplate').mockResolvedValue({ revision: 'r1', names: ['NOME', 'VALOR', 'ENDEREÇO'] });
    vi.spyOn(budgets, 'checkConversationBudget').mockResolvedValue({ blocked_at: null } as never);
    vi.spyOn(ZapSignClient.prototype, 'listTemplates').mockResolvedValue([{ token: 'tpl-1', name: 'Honorários', active: true }]);
    const post = vi.spyOn(ZapSignClient.prototype, 'createDocFromTemplate').mockResolvedValue({
      token: 'doc-agente', status: 'pending', name: 'Honorários', signers: [{ name: 'Maria da Silva', token: 's1', status: 'new', sign_url: 'https://assinatura.invalid/s1' }],
    });
    async function accept(answer = 'Sim', sent = 'sent') {
      const draft = await runAgentContract(db.admin, scope, prepare);
      if (!('solicitar_confirmacao' in draft) || !draft.solicitar_confirmacao) throw new Error(JSON.stringify(draft));
      db.tables.wa_messages.push(msg('2', 'out', draft.solicitar_confirmacao, 1, sent), msg('3', 'in', answer, 2));
      return { ...scope, inboundId: '3' };
    }
    return { ...db, post, accept };
  }
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('cria uma vez após aceite e vincula a entrega à conversa e ao número autorizados', async () => {
    const db = setup(), approved = await db.accept();
    const results = await Promise.all([1, 2].map(() => runAgentContract(db.admin, approved, create)));
    expect(results.some(r => 'criado' in r && r.criado)).toBe(true);
    expect(db.post).toHaveBeenCalledTimes(1);
    expect(db.post.mock.calls[0][0]).toMatchObject({ template_id: 'tpl-1', signer_name: 'Maria da Silva', external_id: db.tables.deal_signatures[0].id,
      send_automatic_email: false, send_automatic_whatsapp: false, data: expect.arrayContaining([{ de: '{{ENDEREÇO}}', para: 'Rua das Flores' }]) });
    expect(db.tables.deal_signatures).toHaveLength(1);
    expect(db.tables.deal_signatures[0]).toMatchObject({ origin: 'agent', status: 'pending', sign_url: 'https://assinatura.invalid/s1' });
    expect(db.tables.deal_signatures[0].request).toMatchObject({ agent_delivery:'conversation',conversation_id:'conv-1', connection_id:'conn-qr',recipient:'+5511988887777' });
    expect(db.tables.deal_events[0]).toMatchObject({ new_value: 'created' });
    expect(h.texts).toEqual([]); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([['não', 'sent'], ['sim, mas troque o valor', 'sent'], ['sim', 'failed']])('não cria com resposta %s e resumo %s', async (answer, sent) => {
    const db = setup(), approved = await db.accept(answer, sent);
    expect(await runAgentContract(db.admin, approved, create)).toMatchObject({ criado: false });
    expect(db.post).not.toHaveBeenCalled();
  });
  it('não aceita modelo alterado depois da confirmação nem valor pessoal inventado', async () => {
    const db = setup(), approved = await db.accept();
    vi.mocked(files.readContractTemplate).mockResolvedValue({ names: ['NOME', 'VALOR', 'ENDEREÇO'], revision: 'r2' });
    expect(await runAgentContract(db.admin, approved, create)).toMatchObject({ criado: false });
    expect(await runAgentContract(db.admin, approved, { ...create, dados: { ENDEREÇO: 'Outro endereço' } })).toMatchObject({ perguntar_ao_cliente: ['ENDEREÇO'] });
    expect(db.post).not.toHaveBeenCalled();
  });
  it('envia somente a URL do cliente mesmo se o escritório for o primeiro signatário', async () => {
    const db=setup(), approved=await db.accept('Sim, pode enviar');
    db.post.mockResolvedValue({token:'doc',name:'Contrato',status:'pending',signers:[
      {token:'office',name:'Escritório',status:'new',sign_url:'https://teste.invalid/escritorio'},
      {token:'client',name:'Maria da Silva',status:'new',sign_url:'https://teste.invalid/cliente'},
    ]});
    await runAgentContract(db.admin,approved,create);
    expect(db.tables.deal_signatures[0]).toMatchObject({sign_url:'https://teste.invalid/cliente',signers:[
      {role:'extra'},{role:'contact'}]});
    await handleZapSignWebhook(db.admin,ORG,{token:'doc',event_type:'doc_signed',status:'pending',
      signer_who_signed:{token:'client',name:'Maria da Silva',status:'signed'}});
    expect(db.tables.deal_signatures[0]).toMatchObject({status:'pending',signers:[
      {role:'extra',status:'new'},{role:'contact',status:'signed'}]});
  });
  it('usa o texto fixo do escritório e exige novo aceite se as condições mudarem', async () => {
    const db = setup();
    const tools = { zapsign_template_token: 'tpl-1', zapsign_variables: { FORO: 'texto:Manaus' } };
    db.tables.wa_ai_agents[0].tools = tools;
    vi.mocked(files.readContractTemplate).mockResolvedValue({ revision: 'r1', names: ['FORO', 'VALOR'] });
    const approved = await db.accept();
    expect(db.tables.wa_messages[1].body).toContain('FORO: Manaus');
    tools.zapsign_variables.FORO = 'texto:Recife';
    expect(await runAgentContract(db.admin, approved, create)).toMatchObject({ criado: false, solicitar_confirmacao: expect.stringContaining('FORO: Recife') });
    expect(db.post).not.toHaveBeenCalled();
  });
  it('coleta um campo definido pelo escritório a partir da fala do cliente', async () => {
    const db = setup();
    db.tables.wa_ai_agents[0].tools = {zapsign_template_token:'tpl-1',zapsign_variables:{REFERÊNCIA:'cliente:perguntar'}};
    vi.mocked(files.readContractTemplate).mockResolvedValue({revision:'r1',names:['REFERÊNCIA']});
    expect(await runAgentContract(db.admin,scope,{...prepare,dados:{}})).toMatchObject({perguntar_ao_cliente:['REFERÊNCIA']});
    expect(await runAgentContract(db.admin,scope,{...prepare,dados:{REFERÊNCIA:'Rua das Flores'}})).toMatchObject({
      solicitar_confirmacao:expect.stringContaining('REFERÊNCIA: Rua das Flores')});
    expect(db.post).not.toHaveBeenCalled();
  });
  it('recusa modelo de outra conta, conversa trocada e pausa por consumo', async () => {
    const db = setup();
    vi.mocked(ZapSignClient.prototype.listTemplates).mockResolvedValue([{ token: 'outro', name: 'Outro' }]);
    await expect(runAgentContract(db.admin, scope, create)).rejects.toThrow(/modelo ativo/);
    await expect(runAgentContract(db.admin, { ...scope, org: 'outro' }, create)).rejects.toThrow(/não permitem/);
    vi.mocked(budgets.checkConversationBudget).mockResolvedValue({ blocked_at: 'agora' } as never);
    await expect(runAgentContract(db.admin, scope, create)).rejects.toThrow(/limite/);
    expect(db.post).not.toHaveBeenCalled();
  });
  it('não usa uma procuração vinculada como modelo do agente, nem mesmo no simulador', async () => {
    const db = setup();
    const child = {token:'tpl-1',name:'Procuração.docx'};
    vi.mocked(ZapSignClient.prototype.listTemplates).mockResolvedValue([child, {token:'pai',name:'Contrato',extra_templates:[child]}]);
    await expect(runAgentContract(db.admin,scope,create)).rejects.toThrow(/modelo ativo/);
    await expect(simulateAgentContract(db.admin,ORG,scope.template,[],prepare)).rejects.toThrow(/não disponível/);
    expect(db.post).not.toHaveBeenCalled();
  });
  it('não reserva nem cria um documento se a conta só permite listar modelos', async () => {
    const db=setup();
    vi.mocked(files.readContractTemplate).mockResolvedValue({revision:'r1',names:['NOME'],planNotice:'É necessário um plano de API.'});
    await expect(runAgentContract(db.admin,scope,create)).rejects.toThrow(/plano de API/);
    expect(db.post).not.toHaveBeenCalled(); expect(db.tables.deal_signatures).toHaveLength(0);
  });
  it('não libera link nem recria o contrato quando o anexo falha; o webhook não contorna a barreira', async () => {
    const db = setup();
    vi.mocked(ZapSignClient.prototype.listTemplates).mockResolvedValue([{token:'tpl-1',name:'Contrato',
      extra_templates:[{token:'child',name:'Procuração'}]}]);
    const approved = await db.accept();
    vi.spyOn(ZapSignClient.prototype,'getDoc').mockResolvedValue({name:'Contrato',token:'doc-agente',status:'pending',signers:[],extra_docs:[]});
    const add = vi.spyOn(ZapSignClient.prototype,'attachTemplate').mockRejectedValue(new Error('Timeout'));
    await expect(runAgentContract(db.admin,approved,create)).rejects.toThrow(/pacote completo/);
    expect(db.tables.deal_signatures[0]).toMatchObject({doc_token:'doc-agente',status:'failed'});
    expect(db.tables.deal_signatures[0].sign_url).toBeFalsy();
    await expect(handleZapSignWebhook(db.admin,ORG,{token:'doc-agente',event_type:'doc_created',signers:[]}))
      .resolves.toMatchObject({action:'package_requires_review'});
    expect(await runAgentContract(db.admin,approved,create)).toMatchObject({ok:false});
    expect(db.post).toHaveBeenCalledTimes(1); expect(add).toHaveBeenCalledTimes(1);
    expect(h.texts).toEqual([]);
  });
  it('não associa o primeiro webhook do principal nem o do anexo ao link do cliente durante a montagem', async () => {
    const db = setup();
    const id = 'cccccccc-aaaa-1111-bbbb-aaaaaaaaaaaa';
    db.tables.deal_signatures.push({id,organization_id:ORG,origin:'agent',status:'processing',doc_token:null,request:{package_expected:3}});
    const created = {token:'doc',external_id:id,event_type:'doc_created',signers:[]};
    expect(await handleZapSignWebhook(db.admin,ORG,created)).toMatchObject({action:'awaiting_package'});
    expect(await handleZapSignWebhook(db.admin,ORG,{...created,token:'extra',parent_doc_token:'doc'})).toMatchObject({action:'ignored_attachment'});
    expect(db.tables.deal_signatures[0]).toMatchObject({status:'processing',doc_token:null});
    expect(db.tables.deal_signatures[0].sign_url).toBeFalsy();
  });
  it('não cria de novo após timeout; webhook autenticado recompõe o vínculo na própria organização', async () => {
    const db = setup(), approved = await db.accept();
    db.post.mockRejectedValue(new Error('timeout'));
    await expect(runAgentContract(db.admin, approved, create)).rejects.toThrow(/não repita/);
    expect(await runAgentContract(db.admin, approved, create)).toMatchObject({ ok: false });
    expect(db.post).toHaveBeenCalledTimes(1);
    const row = db.tables.deal_signatures[0];
    row.id = '11111111-1111-4111-8111-111111111111'; // DB normally generates a UUID.
    const event = { external_id: row.id as string, token: 'doc', event_type: 'doc_created', status: 'pending',
      signers: [{ name: 'Maria da Silva', token: 's1', status: 'new', sign_url: 'https://assinatura.invalid/s1' }] };
    expect((await handleZapSignWebhook(db.admin, 'outro', event)).action).toBe('ignored_unknown_doc');
    await handleZapSignWebhook(db.admin, ORG, event);
    await handleZapSignWebhook(db.admin, ORG, event);
    expect(row).toMatchObject({ status: 'pending', doc_token: 'doc', sign_url: event.signers[0].sign_url });
    expect(db.tables.deal_events.filter(e => e.new_value === 'created')).toHaveLength(1);
  });
  it('preserva uma conferência humana já pendente e bloqueia condições não cadastradas no CRM', async () => {
    const db = setup();
    vi.mocked(files.readContractTemplate).mockResolvedValue({ revision: 'r1', names: ['MULTA'] });
    expect(await runAgentContract(db.admin, scope, { ...create, dados: { MULTA: '10%' } })).toMatchObject({ preencher_no_crm: ['MULTA'] });
    db.tables.deal_signatures.push({ ...queued(), origin: 'rule', status: 'review', template_token: 'tpl-1', doc_token: null });
    expect(await runAgentContract(db.admin, scope, create)).toMatchObject({ ok: false, erro: expect.stringContaining('conferência humana') });
    expect(db.post).not.toHaveBeenCalled();
  });
  it('o painel Testar valida o modelo e o aceite sem chamar criação nem gravar no CRM', async () => {
    const db = setup();
    const chat = [{ role: 'user' as const, text: 'Rua das Flores' }];
    const r = await simulateAgentContract(db.admin, ORG, 'tpl-1', chat, prepare);
    if (!r.solicitar_confirmacao) throw new Error('Prévia esperada');
    expect(await simulateAgentContract(db.admin, ORG, 'tpl-1',
      [...chat, { role: 'assistant', text: r.solicitar_confirmacao }, { role: 'user', text: 'Confirmo' }], create))
      .toMatchObject({ simulado: true, criado: true });
    expect(db.post).not.toHaveBeenCalled(); expect(db.tables.deal_signatures).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled(); expect(h.texts).toEqual([]);
  });
});

describe('conferência antes de enviar (contrato preparado ao entrar na etapa)', () => {
  const review = (): Row => ({ ...(queued() as unknown as Row), id: 'rev-1', status: 'review', attempts: 0, template_token: 'tpl-1', template_name: 'Contrato de honorários' });
  const reviewedRequest = { template_token: 'tpl-1', template_name: 'Contrato de honorários', variables: { NOME: 'contato.nome', VALOR: 'negocio.valor' }, overrides: { VALOR: 'R$ 9.000,00' }, signer: { send: 'link' as const } };

  it('o envio conferido aproveita a linha preparada pelo banco: mesma linha, valores conferidos, histórico registra', async () => {
    const db = base();
    db.tables.deal_signatures.push(review());
    const { row, outcome } = await createManualSignature(db.admin, { organizationId: ORG, dealId: 'deal-1', userId: 'u1', ruleStageId: 'stage-1', request: reviewedRequest, deps: { client: fakeClient() } });
    expect(outcome).toMatchObject({ status: 'pending', sent_via: 'link' });
    expect(row.id).toBe('rev-1');
    expect(row.origin).toBe('rule');
    expect(row.status).toBe('pending');
    expect(row.requested_by).toBe('u1');
    expect(db.tables.deal_signatures).toHaveLength(1);
    expect(h.created[0].data).toEqual(expect.arrayContaining([{ de: '{{NOME}}', para: 'Maria da Silva' }, { de: '{{VALOR}}', para: 'R$ 9.000,00' }]));
    expect(db.tables.deal_events.map((e) => [e.kind, e.new_value])).toEqual([['signature', 'sent']]);
  });

  it('sem linha preparada (etapa já teve contrato), o envio conferido vira um envio manual', async () => {
    const db = base();
    const { row } = await createManualSignature(db.admin, { organizationId: ORG, dealId: 'deal-1', userId: 'u1', ruleStageId: 'stage-1', request: reviewedRequest, deps: { client: fakeClient() } });
    expect(row.origin).toBe('manual');
    expect(row.status).toBe('pending');
    expect(db.tables.deal_signatures).toHaveLength(1);
  });

  it('linha de regra já conferida por uma pessoa envia mesmo se o lead mudou de etapa; sem conferência, cancela', async () => {
    const db = base({ deals: [{ ...base().tables.deals[0], stage_id: 'outra' }] });
    const reviewed: SignatureRow = { ...queued(), request: reviewedRequest };
    db.tables.deal_signatures.push(reviewed as unknown as Row);
    expect((await sendSignature(db.admin, reviewed, { client: fakeClient() })).status).toBe('pending');
    expect((await sendSignature(db.admin, queued(), { client: fakeClient() })).status).toBe('cancelled');
    expect(h.created).toHaveLength(1);
  });

  it('descartar só vale para o que ainda aguarda conferência e fica no histórico com o autor', async () => {
    const db = base();
    db.tables.deal_signatures.push(review(), { ...(queued() as unknown as Row), id: 'sent-1', status: 'pending' });
    const gone = await discardSignature(db.admin, { organizationId: ORG, dealId: 'deal-1', signatureId: 'rev-1', userId: 'u1' });
    expect(gone?.status).toBe('cancelled');
    expect(await discardSignature(db.admin, { organizationId: ORG, dealId: 'deal-1', signatureId: 'sent-1', userId: 'u1' })).toBeNull();
    expect(db.tables.deal_signatures.find((r) => r.id === 'sent-1')?.status).toBe('pending');
    expect(db.tables.deal_events.map((e) => [e.kind, e.new_value, e.actor_kind, e.actor_id])).toEqual([['signature', 'discarded', 'user', 'u1']]);
  });
});
