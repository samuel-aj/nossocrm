import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  rows: {} as Record<string, Row[]>,
  writes: [] as Array<{ table: string; patch: Row; filters: Array<[string, unknown]> }>,
  reads: [] as string[],
  denied: false,
  guard: vi.fn(),
  organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
}));

vi.mock('../../../../_shared', async importOriginal => ({
  ...await importOriginal<object>(),
  guardRoute: async (options: unknown) => {
    h.guard(options);
    if (h.denied) return { ok: false, response: new Response('Forbidden', { status: 403 }) };
    return {
      ok: true,
      user: { id: 'admin', organizationId: h.organizationId },
      admin: { from: (table: string) => {
        h.reads.push(table);
        const filters: Array<[string, unknown]> = [];
        let patch: Row | undefined;
        let applied = false;
        const result = () => {
          const rows = (h.rows[table] ?? []).filter(row => filters.every(([key, value]) => row[key] === value));
          if (patch && !applied) {
            h.writes.push({ table, patch, filters: [...filters] });
            rows.forEach(row => Object.assign(row, patch));
            applied = true;
          }
          return { data: rows.map(row => ({ ...row })), error: null };
        };
        const query = {
          select: () => query,
          eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
          order: () => query,
          update: (value: Row) => { patch = value; return query; },
          maybeSingle: async () => ({ ...result(), data: result().data[0] ?? null }),
          then: (resolve: (value: ReturnType<typeof result>) => unknown) => resolve(result()),
        };
        return query;
      } },
    };
  },
}));

import { PATCH } from './route';
import { AgentMediaInputSchema } from '@/lib/wa-agents/types';

const agentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const mediaId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const foreignId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const script = 'Envie [[midia:boas vindas]] quando começar.';
const patch = (body: unknown) => PATCH(
  new Request(`http://localhost/api/wa-agents/agents/${agentId}/media/${mediaId}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }),
  { params: Promise.resolve({ id: agentId, mediaId }) },
);

beforeEach(() => {
  h.denied = false;
  h.guard.mockClear();
  h.reads = [];
  h.writes = [];
  h.rows = {
    wa_ai_agent_media: [{
      id: mediaId, agent_id: agentId, organization_id: h.organizationId,
      name: 'boas vindas', description: 'Na chegada', send_once_per_conversation: true,
      storage_path: `${h.organizationId}/${agentId}/media/video.mp4`, kind: 'video',
    }],
    wa_ai_agents: [{ id: agentId, organization_id: h.organizationId, system_prompt: script }],
  };
});

describe('media repetition preference PATCH', () => {
  it.each([false, true])('persists %s only on the scoped media and never touches the agent script', async value => {
    const response = await patch({ send_once_per_conversation: value, system_prompt: 'Do not accept this field' });
    expect(response.status).toBe(200);
    expect((await response.json()).media.send_once_per_conversation).toBe(value);
    expect(h.writes).toEqual([{
      table: 'wa_ai_agent_media', patch: { send_once_per_conversation: value },
      filters: [['organization_id', h.organizationId], ['agent_id', agentId], ['id', mediaId]],
    }]);
    expect(h.reads).not.toContain('wa_ai_agents');
    expect(h.rows.wa_ai_agents[0].system_prompt).toBe(script);
    expect(h.guard).toHaveBeenCalledWith(expect.objectContaining({ admin: true, agents: true, req: expect.any(Request) }));
  });

  it.each([true, false])('renaming preserves the saved %s preference while rewriting only the existing marker', async value => {
    h.rows.wa_ai_agent_media[0].send_once_per_conversation = value;
    const response = await patch({ name: 'saudacao' });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.media.send_once_per_conversation).toBe(value);
    expect(h.writes[0].patch).toEqual({ name: 'saudacao' });
    expect(result.system_prompt).toBe('Envie [[midia:saudacao]] quando começar.');
  });

  it.each(['organization_id', 'agent_id'])('refuses a media belonging to another %s without any mutation', async field => {
    h.rows.wa_ai_agent_media[0][field] = foreignId;
    expect((await patch({ send_once_per_conversation: false })).status).toBe(404);
    expect(h.writes).toEqual([]);
  });

  it.each(['false', null, 0])('refuses a non-boolean setting (%j)', async value => {
    expect((await patch({ send_once_per_conversation: value })).status).toBe(400);
    expect(h.writes).toEqual([]);
  });

  it('keeps saved false on metadata-only edits and empty legacy PATCH payloads', async () => {
    h.rows.wa_ai_agent_media[0].send_once_per_conversation = false;
    expect((await patch({ description: 'Ao explicar o serviço' })).status).toBe(200);
    expect(h.writes[0].patch).toEqual({ description: 'Ao explicar o serviço' });
    h.writes = [];
    expect((await (await patch({})).json()).media.send_once_per_conversation).toBe(false);
    expect(h.writes).toEqual([]);
  });

  it('does not query data after the authorization guard rejects access', async () => {
    h.denied = true;
    expect((await patch({ send_once_per_conversation: false })).status).toBe(403);
    expect(h.reads).toEqual([]);
    expect(h.writes).toEqual([]);
  });

  it('defaults old upload payloads to true and preserves an explicit false', () => {
    const input = { name: 'video', kind: 'video', storage_path: 'file.mp4', mime: 'video/mp4', size_bytes: 10 };
    expect(AgentMediaInputSchema.parse(input).send_once_per_conversation).toBe(true);
    expect(AgentMediaInputSchema.parse({ ...input, send_once_per_conversation: false }).send_once_per_conversation).toBe(false);
  });
});
