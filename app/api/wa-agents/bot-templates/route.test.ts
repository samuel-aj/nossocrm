import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ rows: {} as Record<string, Array<Record<string, any>>>, written: [] as Array<Record<string, any>>, user: { id: 'user', role: 'admin', organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } }));
vi.mock('../_shared', async importOriginal => ({ ...await importOriginal<object>(), guardRoute: async () => ({ ok: true, isAdmin: true, user: h.user, admin: { from: (table: string) => {
  let rows = [...(h.rows[table] ?? [])]; let columns = '*';
  const result = () => ({ data: rows.map(r => columns === '*' ? r : Object.fromEntries(columns.split(',').map(c => [c, r[c]]))), error: null });
  const q = { select: (c: string) => { columns = c; return q; }, eq: (k: string, v: unknown) => { rows = rows.filter(r => r[k] === v); return q; }, in: (k: string, vs: unknown[]) => { rows = rows.filter(r => vs.includes(r[k])); return q; }, is: () => q, order: () => q,
    or: (scope: string) => { const org = scope.match(/organization_id.eq.([^,]+)/)?.[1]; rows = rows.filter(r => r.organization_id === org || (r.official && (!scope.includes('published.eq.true') || r.published))); return q; },
    insert: (row: Record<string, any>) => { const inserted = { ...row, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }; rows = [inserted]; h.written.push(inserted); return q; },
    update: (row: Record<string, any>) => { h.written.push(row); return q; },
    single: async () => ({ data: result().data[0] ?? null, error: null }), maybeSingle: async () => ({ data: result().data[0] ?? null, error: null }), then: (resolve: (value: unknown) => unknown) => resolve(result()),
  }; return q;
} } }) }));
import { GET, POST } from './route';
import { PATCH } from './[id]/route';
import { createBotTemplate } from '@/lib/wa-agents/botTemplates';
const foreignOrg = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const templateId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const number = '11111111-1111-4111-8111-111111111111';
const bot = { name: 'Modelo', enabled: true, connection_id: number, connection_ids: [number], trigger: { type: 'manual' }, steps: [{ id: 'end', type: 'end' }] };
const request = (body: unknown) => new Request('http://localhost/api/wa-agents/bot-templates', { method: 'POST', body: JSON.stringify(body) });
beforeEach(() => { h.user.role = 'admin'; h.rows = { profiles: [{ id: 'user', role: 'admin' }], wa_connections: [{ id: number, organization_id: h.user.organizationId }] }; h.written = []; });
describe('bot template API', () => {
  it('hides foreign private templates and refuses importing them by ID', async () => {
    h.rows.wa_bot_templates = [{ id: templateId, organization_id: foreignOrg, official: false, published: false, snapshot: createBotTemplate(bot) }];
    expect((await (await GET()).json()).templates).toEqual([]);
    expect((await POST(request({ action: 'import', templateId, name: 'Cópia' }))).status).toBe(404);
    expect(h.written).toEqual([]);
  });
  it('exposes only published official snapshots without origin organization or creator', async () => {
    h.rows.wa_bot_templates = [{ id: templateId, organization_id: foreignOrg, created_by: 'source-user', official: true, published: true, snapshot: createBotTemplate(bot) }];
    const response = await (await GET()).json(); expect(response.templates).toHaveLength(1);
    expect(JSON.stringify(response)).not.toMatch(/source-user|aaaaaaaa-aaaa/);
    h.rows.wa_bot_templates[0].published = false;
    expect((await (await GET()).json()).templates).toEqual([]);
  });
  it('imports a validated, independent disabled copy owned by the destination org', async () => {
    const snapshot = createBotTemplate(bot); const bindings = { [snapshot.dependencies[0].ref]: number };
    const response = await POST(request({ action: 'import', snapshot, bindings, name: 'Nova cópia' }));
    expect(response.status).toBe(201); expect(h.written[0]).toMatchObject({ enabled: false, organization_id: h.user.organizationId, name: 'Nova cópia', created_by: 'user' });
    expect(snapshot.bot.connection_id).not.toBe(number);
  });
  it('refuses invalid imports, foreign destination bindings and unmapped numbers', async () => {
    const snapshot = createBotTemplate(bot);
    expect((await POST(request({ action: 'import', snapshot: { version: 2 }, name: 'Cópia' }))).status).toBe(400);
    expect((await POST(request({ action: 'import', snapshot, name: 'Cópia' }))).status).toBe(400);
    h.rows.wa_connections[0].organization_id = foreignOrg;
    expect((await POST(request({ action: 'import', snapshot, bindings: { [snapshot.dependencies[0].ref]: number }, name: 'Cópia' }))).status).toBe(400);
    expect(h.written).toEqual([]);
  });
  it('checks persisted real role for official creation and publication', async () => {
    h.user.role = 'super_admin';
    expect((await POST(request({ action: 'save', bot, name: 'Oficial', official: true }))).status).toBe(403);
    expect((await PATCH(request({ published: true }), { params: Promise.resolve({ id: templateId }) })).status).toBe(403);
    expect(h.written).toEqual([]);
  });
});
