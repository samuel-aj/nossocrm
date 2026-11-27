import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { memoryDb } from '@/test/helpers/mcpMemoryDb';
import { AI_AGENT_READ_SCOPE, AI_AGENT_WRITE_PROMPT_SCOPE } from '@/lib/apiKeys/accessModes';
import { zodToJsonSchema2020 } from '../zodToJsonSchema';
import { addAiAgentTools } from './tools';
import { conversationsSchema, restoreSchema, transcriptSchema, updateSchema } from './schemas';

const id = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const org = id(1), foreign = id(2), agent = id(3), off = id(4), chat = id(5), key = id(6);
const at = '2026-11-25T12:00:00.123456+00:00';
const scopes = [AI_AGENT_READ_SCOPE, AI_AGENT_WRITE_PROMPT_SCOPE];
const approval = { agentId: agent, expectedVersion: 1, changeSummary: 'Revisão aprovada', externalRef: 'ANN-12 #aprovação' };

function fixture(permissions: string[] | null = scopes, role = 'admin') {
  const metadata = { enabled: true, name: 'Agente', model: 'modelo', connection_ids: [], api_key: 'key-private', audio_api_key: 'audio-private' };
  const message = { organization_id: org, conversation_id: chat, created_at: at, direction: 'out', media_url: 'never-return-file', from_phone: '5567999999999' };
  const db = memoryDb({
    wa_ai_agents: [
      { id: agent, ...metadata, organization_id: org, squad_monitoring: true },
      { id: off, ...metadata, organization_id: org, squad_monitoring: false },
      { id: id(7), ...metadata, organization_id: foreign, squad_monitoring: true },
    ],
    wa_ai_agent_prompt_versions: [0, 1].map(version => ({
      organization_id: org, agent_id: agent, version, source: version ? 'manual' : 'original',
      system_prompt: 'Roteiro ' + version, stop_rules: 'Encerrar', created_at: at,
    })),
    wa_ai_agent_documents: [
      { id: id(8), organization_id: org, agent_id: agent, name: 'faq.pdf', title: 'Dúvidas', status: 'ready', storage_path: 'secret-path' },
      { id: id(9), organization_id: foreign, agent_id: agent, name: 'foreign.pdf' },
    ],
    wa_conversations: [{ id: chat, organization_id: org, wa_phone: '5567999994321' }],
    wa_ai_agent_runs: [{ id: id(10), organization_id: org, agent_id: agent, conversation_id: chat, trigger: 'inbound' }],
    wa_messages: [
      { ...message, id: id(11), direction: 'in', body: 'Ligue no +55 (67)\u00a099999‑4321' },
      { ...message, id: id(12), source: 'agent', media_type: 'audio', body: 'never-return-caption', transcription: 'Recebi o 99999-4321.' },
      { ...message, id: id(13), source: 'crm', sent_by: id(99), body: 'Olá' },
      { ...message, id: id(14), source: 'bot', media_type: 'video', body: 'never-return-media' },
      { ...message, id: id(15), body: 'never-return-deleted', deleted_at: at },
      { ...message, id: id(16), organization_id: foreign, body: 'never-return-foreign' },
      { ...message, id: id(17), direction: 'in', media_type: 'document', transcription: 'never-return-pdf' },
      { ...message, id: id(18), direction: 'in', media_type: 'image', transcription: 'never-return-image-ocr' },
      { ...message, id: id(19), direction: 'in', body: '👤 Contatos compartilhados:\nnever-return-contacts' },
      { ...message, id: id(20), direction: 'in', body: '📍 never-return-location\nhttps://maps.google.com/?q=1,2' },
      { ...message, id: id(21), source: 'echo', sent_by: null, body: 'Confirmado' },
    ],
  });
  const ok = (data: unknown) => ({ data, error: null });
  const rpc = vi.fn(async (name: string, params: Record<string, unknown>) => {
    if (name === 'wa_ai_agent_prompt_snapshots') return ok([{ agent_id: agent, version: 1 }, { agent_id: off, version: 0 }]);
    if (params.p_agent_id !== agent) return { data: null, error: { code: 'P0002' } };
    if (name === 'wa_ai_agent_prompt_snapshot') return ok(1);
    if (name === 'wa_ai_agent_conversations') return ok([{ conversation_id: chat }, { conversation_id: id(77) }]);
    if (name === 'wa_ai_agent_prompt_change') return ok(2);
    throw new Error('unsupported RPC');
  });
  const admin = { ...db, rpc } as unknown as SupabaseClient;
  const registry = addAiAgentTools({ tools: [], toolByMcpName: {}, internalKeyByMcpName: {}, mcpNameByInternalKey: {} },
    { admin, apiKeyId: key, user: { id: id(90), organizationId: org, role } }, permissions);
  const call = async (name: string, args: unknown) => registry.toolByMcpName['crm.ai_agents.' + name].execute!(args);
  return { call, registry, rpc, db };
}

describe('AgentMaker tools', () => {
  it('registers the same scoped names for discovery and dispatch, with MCP object schemas', () => {
    for (const [permissions, count] of [[null, 8], [scopes, 8], [[AI_AGENT_READ_SCOPE], 6], [[AI_AGENT_WRITE_PROMPT_SCOPE], 2], [['unknown'], 0], [[], 0]] as const) {
      const { registry } = fixture(permissions ? [...permissions] : null);
      expect(registry.tools).toHaveLength(count);
      expect(Object.keys(registry.toolByMcpName).sort()).toEqual(registry.tools.map(t => t.name).sort());
      for (const tool of registry.tools) {
        expect(zodToJsonSchema2020(tool.inputSchemaZod)).toMatchObject({ type: 'object', additionalProperties: false });
        expect(tool.annotations?.readOnlyHint).toBe(!tool.name.includes('.prompt.'));
      }
    }
    expect(fixture(scopes, 'vendedor').registry.tools).toEqual([]);
  });

  it('lists only tenant metadata, including unmonitored agents, with one batch of version numbers', async () => {
    const { call, rpc } = fixture();
    const result = await call('list', { limit: 2 });
    expect(result.agents.map((a: { id: string }) => a.id)).toEqual([agent, off]);
    expect(result.agents[1]).toMatchObject({ squad_monitoring: false, version: 0 });
    expect(result.agents[0]).not.toHaveProperty('api_key');
    expect(result.agents[0]).not.toHaveProperty('audio_api_key');
    expect(result.agents[0]).not.toHaveProperty('system_prompt');
    expect(rpc).toHaveBeenCalledWith('wa_ai_agent_prompt_snapshots', { p_organization_id: org, p_agent_ids: [agent, off] });
    expect((await call('list', { afterId: agent, limit: 1 })).agents[0].id).toBe(off);
  });

  it('reads both texts from an exact snapshot and projects only document metadata', async () => {
    const { call } = fixture();
    expect(await call('get', { agentId: agent })).toMatchObject({ id: agent, version: 1, system_prompt: 'Roteiro 1', stop_rules: 'Encerrar',
      documents: [{ name: 'faq.pdf', title: 'Dúvidas', status: 'ready' }] });
    expect((await call('get', { agentId: agent })).documents[0]).not.toHaveProperty('storage_path');
    for (const agentId of [off, id(7), id(999)]) {
      for (const name of ['get', 'versions.get', 'versions.list', 'transcript']) {
        expect(await call(name, { agentId, version: 0, conversationId: chat, limit: 2 })).toMatchObject({ code: 'UNAVAILABLE' });
      }
    }
  });

  it('paginates revision metadata without returning the texts; individual reads contain the full texts', async () => {
    const { call } = fixture();
    const result = await call('versions.list', { agentId: agent, limit: 1 });
    expect(result).toMatchObject({ currentVersion: 1, versions: [{ version: 1 }], nextCursor: 1 });
    expect(result.versions[0]).not.toHaveProperty('system_prompt');
    expect(await call('versions.list', { agentId: agent, beforeVersion: 1, limit: 1 })).toMatchObject({ versions: [{ version: 0 }], nextCursor: null });
    expect(await call('versions.get', { agentId: agent, version: 0 })).toMatchObject({ revision: { system_prompt: 'Roteiro 0' } });
  });

  it('requires a time zone, a positive interval up to seven days, and paginates after aggregation', async () => {
    const from = '2026-11-18T15:00:00-04:00', to = '2026-11-25T19:00:00Z';
    const input = { agentId: agent, from, to, limit: 1 };
    expect(conversationsSchema.safeParse(input).success).toBe(true);
    for (const invalid of [{ from: to }, { to: '2026-11-25T19:00:01Z' }, { from: '2026-11-18T15:00:00' }, { limit: 101 }]) {
      expect(conversationsSchema.safeParse({ ...input, ...invalid }).success).toBe(false);
    }
    const { call, rpc } = fixture();
    expect(await call('conversations', input)).toEqual({ conversations: [{ conversation_id: chat }], nextCursor: chat });
    expect(rpc).toHaveBeenCalledWith('wa_ai_agent_conversations', { p_agent_id: agent, p_organization_id: org, p_from: from, p_to: to, p_after_id: null, p_limit: 2 });
  });

  it('masks phones, omits media and deleted content, and distinguishes humans, agents and bots', async () => {
    const { call } = fixture();
    const result = await call('transcript', { agentId: agent, conversationId: chat, limit: 30 });
    expect(result.phone).toBe('••••4321');
    expect(result.messages.map((m: { author: string; text: string | null }) => [m.author, m.text])).toEqual([
      ['lead', 'Ligue no ••••4321'], ['agent', 'Recebi o ••••4321.'], ['person', 'Olá'], ['automation', null],
      ['lead', null], ['lead', null], ['lead', null], ['lead', null], ['unknown', 'Confirmado'],
    ]);
    expect(JSON.stringify(result)).not.toContain('never-return');
    const page = await call('transcript', { agentId: agent, conversationId: chat, limit: 1 });
    expect(page.nextCursor).toEqual({ at, id: id(11) });
    expect(transcriptSchema.safeParse({ agentId: agent, conversationId: chat, after: page.nextCursor }).success).toBe(true);
  });

  it('requires a real run in the same organization and conversation before reading messages', async () => {
    const { call, db } = fixture();
    db.tables.wa_ai_agent_runs[0].trigger = 'test';
    db.tables.wa_ai_agent_runs.push({ agent_id: agent, trigger: 'inbound', organization_id: foreign, conversation_id: chat });
    expect(await call('transcript', { agentId: agent, conversationId: chat, limit: 10 })).toMatchObject({ code: 'UNAVAILABLE' });
    expect(db.calls.some(c => c.table === 'wa_messages')).toBe(false);
  });

  it('requires approval metadata, allows partial edits, and applies the same audio markup validation as the agent editor', async () => {
    const input = { ...approval, stop_rules: '' };
    expect(updateSchema.parse(input)).not.toHaveProperty('system_prompt');
    expect(updateSchema.safeParse(approval).success).toBe(false);
    for (const invalid of [{ externalRef: ' ' }, { changeSummary: '' }, { expectedVersion: -1 }, { model: 'new' }, { system_prompt: '[audio]aberto' }]) {
      expect(updateSchema.safeParse({ ...input, ...invalid }).success).toBe(false);
    }
    expect(restoreSchema.safeParse({ ...approval, version: 0, externalRef: '' }).success).toBe(false);
    const { call, rpc } = fixture();
    expect(await call('prompt.update', input)).toEqual({ agentId: agent, version: 2 });
    expect(rpc).toHaveBeenLastCalledWith('wa_ai_agent_prompt_change', expect.objectContaining({
      p_key_id: key, p_organization_id: org, p_expected_version: 1, p_external_ref: approval.externalRef,
      p_system_prompt: null, p_stop_rules: '', p_restore_version: null,
    }));
    await call('prompt.restore', { ...approval, version: 0 });
    expect(rpc).toHaveBeenLastCalledWith('wa_ai_agent_prompt_change', expect.objectContaining({
      p_restore_version: 0, p_expected_version: 1, p_system_prompt: null, p_stop_rules: null,
    }));
  });

  it('reports stale versions and sanitizes unexpected database errors', async () => {
    const { call, rpc } = fixture();
    rpc.mockResolvedValueOnce({ data: null, error: { code: '40001' } });
    expect(await call('prompt.update', { ...approval, system_prompt: 'Oi' })).toMatchObject({ code: 'VERSION_CONFLICT' });
    rpc.mockRejectedValueOnce(new Error('private internal payload'));
    const error = await call('get', { agentId: agent });
    expect(error).toMatchObject({ code: 'AI_AGENTS_UNAVAILABLE' });
    expect(JSON.stringify(error)).not.toContain('private internal payload');
  });
});
