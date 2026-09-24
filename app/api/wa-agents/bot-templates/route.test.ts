import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ rows: {} as Record<string, Array<Record<string, any>>>, written: [] as Array<Record<string, any>>, user: { id: 'user', role: 'admin', organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } }));
vi.mock('../_shared', async importOriginal => ({ ...await importOriginal<object>(), guardRoute: async () => ({ ok: true, isAdmin: true, user: h.user, admin: { from: (table: string) => {
  let rows = [...(h.rows[table] ?? [])]; let columns = '*';
  const result = () => ({ data: rows.map(r => columns === '*' ? r : Object.fromEntries(columns.split(',').map(c => c.trim()).map(c => [c, r[c]]))), error: null });
  const q = { select: (c: string) => { columns = c; return q; }, eq: (k: string, v: unknown) => { rows = rows.filter(r => r[k] === v); return q; }, in: (k: string, vs: unknown[]) => { rows = rows.filter(r => vs.includes(r[k])); return q; }, is: () => q, order: () => q,
    or: (scope: string) => { const org = scope.match(/organization_id.eq.([^,]+)/)?.[1]; rows = rows.filter(r => r.organization_id === org || (r.official && (!scope.includes('published.eq.true') || r.published))); return q; },
    insert: (row: Record<string, any>) => { const inserted = { ...row, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }; rows = [inserted]; h.written.push(inserted); return q; },
    update: (row: Record<string, any>) => { h.written.push(row); return q; },
    single: async () => ({ data: result().data[0] ?? null, error: null }), maybeSingle: async () => ({ data: result().data[0] ?? null, error: null }), then: (resolve: (value: unknown) => unknown) => resolve(result()),
  }; return q;
} } }) }));
import { GET, POST } from './route';
import { PATCH } from './[id]/route';
import { PATCH as PATCH_BOT } from '../bots/[id]/route';
import { POST as POST_BOT } from '../bots/route';
import type { BotStep } from '@/lib/wa-agents/types';
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


describe('imported bot activation completeness', () => {
  it.each([
    ['Aceito', 'Recuso'],
    ['Não', 'Sim'],
    ['Sim'],
  ])('keeps routing and reports pending when destination quick replies are %j', async (...labels) => {
    const source = { ...bot, start_step_id: 'message', steps: [
      { id: 'message', type: 'send_template', template_id: templateId, buttons: ['Sim', 'Não'], button_step_ids: ['yes', 'no'], next_step_id: 'other' },
      { id: 'yes', type: 'end' }, { id: 'no', type: 'end' }, { id: 'other', type: 'end' },
    ] };
    const snapshot = createBotTemplate(source);
    h.rows.message_templates = [{ id: templateId, organization_id: h.user.organizationId, name: 'Destino', type: 'whatsapp_api', connection_id: number, meta_status: 'APPROVED', buttons: labels.map(text => ({ type: 'QUICK_REPLY', text })) }];
    const bindings = Object.fromEntries(snapshot.dependencies.map(d => [d.ref, d.kind === 'connection' ? number : templateId]));
    const imported = await POST(request({ action: 'import', snapshot, bindings, name: 'Cópia' }));
    expect(imported.status).toBe(201);
    const body = await imported.json();
    expect(body.pending.join(' ')).toContain('botões');
    expect(body.bot.steps[0]).toMatchObject({ buttons: ['Sim', 'Não'], button_step_ids: ['yes', 'no'], next_step_id: 'other' });
    h.rows.wa_bots = [body.bot]; h.written = [];
    const activated = await PATCH_BOT(request({ enabled: true }), { params: Promise.resolve({ id: body.bot.id }) });
    expect(activated.status).toBe(400);
    expect((await activated.json()).error).toContain('botões');
    expect(h.written).toEqual([]);
    const activeCopy = await POST_BOT(request({ ...body.bot, enabled: true }));
    expect(activeCopy.status).toBe(400);
    expect((await activeCopy.json()).error).toContain('botões');
    expect(h.written).toEqual([]);
  });

  it('accepts matching quick replies but rechecks current labels after import', async () => {
    const source = { ...bot, steps: [{ id: 'message', type: 'send_template', template_id: templateId, buttons: ['Sim', 'Não'], button_step_ids: [null, null] }] };
    const snapshot = createBotTemplate(source);
    h.rows.message_templates = [{ id: templateId, organization_id: h.user.organizationId, name: 'Destino', type: 'whatsapp_api', connection_id: number, meta_status: 'APPROVED', buttons: [{ type: 'URL', text: 'Site' }, { type: 'QUICK_REPLY', text: ' Sim ' }, { type: 'QUICK_REPLY', text: 'Não' }] }];
    const bindings = Object.fromEntries(snapshot.dependencies.map(d => [d.ref, d.kind === 'connection' ? number : templateId]));
    const imported = await POST(request({ action: 'import', snapshot, bindings, name: 'Cópia' }));
    const body = await imported.json(); expect(imported.status).toBe(201); expect(body.pending).toEqual([]);
    h.rows.wa_bots = [body.bot]; h.written = [];
    const activated = await PATCH_BOT(request({ enabled: true }), { params: Promise.resolve({ id: body.bot.id }) });
    expect(activated.status).toBe(200); expect(h.written[0]).toMatchObject({ enabled: true });
    h.rows.message_templates[0].buttons[1].text = 'Aceito'; h.written = [];
    const changed = await PATCH_BOT(request({ enabled: true }), { params: Promise.resolve({ id: body.bot.id }) });
    expect(changed.status).toBe(400); expect((await changed.json()).error).toContain('botões'); expect(h.written).toEqual([]);
  });

  const incomplete: Array<{ step: BotStep; message: string }> = [
    { step: { id: 'owner', type: 'update_lead', changes: [{ field: 'owner_id', mode: 'replace' }] }, message: 'Responsável' },
    { step: { id: 'field', type: 'update_lead', changes: [{ field: 'custom_field', key: '  ', mode: 'clear' }] }, message: 'Campo personalizado' },
    { step: { id: 'owner', type: 'update_lead', changes: [{ field: 'owner_id', mode: 'replace', value: '' }] }, message: 'Responsável' },
    { step: { id: 'owner', type: 'update_lead', changes: [{ field: 'owner_id', mode: 'replace', value: '   ' }] }, message: 'Responsável' },
    { step: { id: 'field', type: 'update_lead', changes: [{ field: 'custom_field', mode: 'replace', value: 'x' }] }, message: 'Campo personalizado' },
    { step: { id: 'condition', type: 'condition', rules: [{ match: 'all', kind: 'reply_contains', keywords: [], clauses: [{ field: 'custom_field', op: 'is_empty', value: '' }], goto_step_id: 'end' }] }, message: 'Campo personalizado' },
  ];
  it.each(incomplete)('keeps missing semantic binding pending and blocks saved/imported/PATCH activation: $message', async ({ step, message }) => {
    const source = { ...bot, connection_id: null, connection_ids: [], steps: [step, { id: 'end', type: 'end' }] };
    const snapshot = createBotTemplate(source);
    const imported = await POST(request({ action: 'import', snapshot, name: 'Cópia' }));
    expect(imported.status).toBe(201);
    const body = await imported.json();
    expect(body.pending.join(' ')).toContain(message);
    h.rows.wa_bots = [body.bot]; h.written = [];
    for (const patch of [{ enabled: true }, { enabled: true, steps: source.steps }]) {
      const activated = await PATCH_BOT(request(patch), { params: Promise.resolve({ id: body.bot.id }) });
      expect(activated.status).toBe(400);
      expect((await activated.json()).error).toContain(message);
    }
    const createdActive = await POST_BOT(request(source));
    expect(createdActive.status).toBe(400);
    expect((await createdActive.json()).error).toContain(message);
    expect(h.written).toEqual([]);
  });
  it('allows explicit owner clear and genuinely optional trigger bindings', async () => {
    const source = { ...bot, connection_id: null, connection_ids: [], steps: [{ id: 'owner', type: 'update_lead', changes: [{ field: 'owner_id', mode: 'clear' }] }] };
    const snapshot = createBotTemplate(source);
    const imported = await POST(request({ action: 'import', snapshot, name: 'Cópia' }));
    const body = await imported.json(); expect(body.pending).toEqual([]);
    h.rows.wa_bots = [body.bot]; h.written = [];
    const activated = await PATCH_BOT(request({ enabled: true }), { params: Promise.resolve({ id: body.bot.id }) });
    expect(activated.status).toBe(200); expect(h.written[0]).toMatchObject({ enabled: true });
  });
});
