import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { manualAgentFollowup } from './manualAgentFollowup';
import { agentContractFact, manualContractIssued } from './agentContractFact';

type Row = Record<string, unknown>;
function database(tables: Record<string, Row[]>, fail = false) {
  return { from(table: string) {
    const filters: ((row: Row) => boolean)[] = [];
    let cap = Infinity;
    let single = false;
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => (filters.push(r => r[key] === value), query),
      in: (key: string, values: unknown[]) => (filters.push(r => values.includes(r[key])), query),
      not: (key: string, _op: string, value: unknown) => (filters.push(r => (r[key] ?? null) !== value), query),
      contains: (key: string, values: Row) => (filters.push(r => Object.entries(values).every(([k,v]) => (r[key] as Row)?.[k] === v)), query),
      order: () => query,
      limit: (n: number) => (cap = n, query),
      maybeSingle: () => (single = true, query),
      then: (resolve: (value: unknown) => void) => {
        const rows = (tables[table] ?? []).filter(r => filters.every(f => f(r)))
          .sort((a,b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0,cap);
        resolve({ data: single ? rows[0] ?? null : rows, error: fail ? { message: 'unavailable' } : null });
      },
    };
    return query;
  } } as unknown as SupabaseClient;
}
const scope = { organizationId: 'org', dealId: 'lead', contactId: 'person', templateToken: 'model' };
const conversation = { id: 'chat', organization_id: 'org', deal_id: 'lead', contact_id: 'person', connection_id: 'number',
  wa_phone: '+5511999999999', ai_agent_id: 'agent', is_group: false, ai_status: 'active' };
const config = { id: 'agent', organization_id: 'org', enabled: true, tools: { zapsign_template_token: 'model' }, connection_ids: ['number'] };
const issued = { id: 'contract', organization_id: 'org', deal_id: 'lead', contact_id: 'person', template_token: 'model',
  origin: 'manual', status: 'pending', doc_token: 'document', signers: [], created_at: '2026-11-14T11:47:00Z',
  request: { agent_delivery: 'signed_only' }, sent_via: 'crm_whatsapp', sent_at: '2026-11-14T11:47:00Z', notices: [] };

describe('contrato manual e atendimento existente, sem transportes', () => {
  it.each(['active','paused'])('vincula somente pós-assinatura e preserva sessão %s', async ai_status => {
    const conv = { ...conversation, ai_status };
    const db = database({ wa_conversations: [conv], wa_ai_agents: [config] });
    expect(await manualAgentFollowup(db,scope)).toEqual({ agent_delivery: 'signed_only', agent_id: 'agent',
      conversation_id: 'chat', connection_id: 'number', recipient: '+5511999999999' });
    expect(conv.ai_status).toBe(ai_status);
  });
  it('não escolhe uma conversa quando o mesmo lead está ativo em dois números', async () => {
    const db = database({ wa_conversations: [conversation, { ...conversation,id:'second',connection_id:'second-number' }], wa_ai_agents:[config] });
    expect(await manualAgentFollowup(db,scope)).toEqual({});
  });
  it.each([
    { organization_id: 'another' }, { deal_id: 'other-lead' }, { contact_id: 'other-person' },
    { ai_status: 'stopped' }, { is_group: true }, { ai_agent_id: null },
  ])('não associa atendimento incompatível %j', async patch => {
    const db = database({ wa_conversations:[{...conversation,...patch}],wa_ai_agents:[config] });
    expect(await manualAgentFollowup(db,scope)).toEqual({});
  });
  it.each([{ enabled:false }, { tools:{zapsign_template_token:'other-model'} },{ connection_ids:['other-number'] }])('não associa agente incompatível %j',async patch=>{
    const db=database({wa_conversations:[conversation],wa_ai_agents:[{...config,...patch}]});
    expect(await manualAgentFollowup(db,scope)).toEqual({});
  });
  it('fornece fato do contrato emitido manualmente sem pressupor envio do link',async()=>{
    const db=database({deal_signatures:[{...issued,sent_via:'link'}]});
    expect(await agentContractFact(db,'org','chat','agent','lead','person','model')).toContain('ficha concluída pela equipe');
    expect(await agentContractFact(db,'org','chat','agent','lead','person','model')).toContain('envio ao cliente não confirmado');
    expect(await manualContractIssued(db,scope)).toBe(true);
  });
  it('contrato antigo informa o estado sem alegar acompanhamento automático',async()=>{
    const db=database({deal_signatures:[{...issued,request:{},status:'signed'}]});
    const fact=await agentContractFact(db,'org','chat','agent','lead','person','model');
    expect(fact).toContain('Documento assinado por todos');
    expect(fact).toContain('Emissão anterior sem acompanhamento automático');
  });
  it('suprime o ciclo anterior à emissão, permitindo retomada após nova mensagem do cliente',async()=>{
    const db=database({deal_signatures:[issued]});
    expect(await manualContractIssued(db,{...scope,silentSince:'2026-11-14T10:00:00Z'})).toBe(true);
    expect(await manualContractIssued(db,{...scope,silentSince:'2026-11-14T12:00:00Z'})).toBe(false);
  });
  it('usa a emissão da conferência antiga e não confunde link gerado com convite enviado',async()=>{
    const db=database({deal_signatures:[{...issued,origin:'rule',created_at:'2026-11-01T08:00:00Z',sent_via:'link',
      sent_at:'2026-11-14T11:47:00Z',updated_at:'2026-11-15T18:00:00Z'}]});
    expect(await manualContractIssued(db,{...scope,silentSince:'2026-11-14T10:00:00Z'})).toBe(true);
    expect(await manualContractIssued(db,{...scope,silentSince:'2026-11-14T12:00:00Z'})).toBe(false);
    const fact=await agentContractFact(db,'org','chat','agent','lead','person','model');
    expect(fact).toContain('Link gerado; envio ao cliente não confirmado');
  });
  it('seleciona a emissão mais recente mesmo quando a reserva foi criada antes de outro contrato',async()=>{
    const db=database({deal_signatures:[
      {...issued,id:'newer-reservation',created_at:'2026-11-13T08:00:00Z',sent_at:'2026-11-13T08:05:00Z'},
      {...issued,id:'older-reservation',origin:'rule',created_at:'2026-11-01T08:00:00Z',sent_at:'2026-11-14T11:47:00Z'},
    ]});
    expect(await manualContractIssued(db,{...scope,silentSince:'2026-11-14T10:00:00Z'})).toBe(true);
  });
  it('não usa a data de atualização do webhook como data de emissão de registro legado',async()=>{
    const db=database({deal_signatures:[{...issued,sent_at:null,updated_at:'2026-11-15T18:00:00Z'}]});
    expect(await manualContractIssued(db,{...scope,silentSince:'2026-11-14T10:00:00Z'})).toBe(true);
    expect(await manualContractIssued(db,{...scope,silentSince:'2026-11-14T12:00:00Z'})).toBe(false);
  });
  it.each([{status:'failed'},{status:'processing'},{doc_token:null},{origin:'agent'},{organization_id:'other'},
    {deal_id:'other'},{contact_id:'other'},{template_token:'other'},{request:{package_unverified:true}}])('não confunde registro fora do escopo com contrato emitido %j',async patch=>{
    const db=database({deal_signatures:[{...issued,...patch}]});
    expect(await manualContractIssued(db,scope)).toBe(false);
    expect(await agentContractFact(db,'org','chat','agent','lead','person','model')).toBe('');
  });
  it('não libera a régua quando a consulta falha',async()=>{
    const db=database({},true);
    await expect(manualContractIssued(db,scope)).rejects.toThrow('conferir o contrato');
    expect(await agentContractFact(db,'org','chat','agent','lead','person','model')).toContain('indisponível');
    await expect(manualAgentFollowup(db,scope)).rejects.toThrow('conferir o atendimento');
  });
});
