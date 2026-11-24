import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  role: 'admin' as string,
  inserts: [] as Array<Record<string, unknown>>,
  rows: [] as Array<Record<string, unknown>>,
  filters: [] as Array<[string, string, unknown]>,
}));

vi.mock('@/lib/supabase/server', () => {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    const chain = (name: string) => (col: string, value: unknown) => {
      state.filters.push([name, col, value]);
      return b;
    };
    Object.assign(b, {
      select: () => b,
      gte: chain('gte'),
      lt: chain('lt'),
      eq: chain('eq'),
      in: chain('in'),
      order: () => b,
      limit: () => b,
      single: async () => ({ data: state.user ? { id: state.user.id, role: state.role } : null, error: null }),
      insert: async (row: Record<string, unknown>) => {
        state.inserts.push(row);
        return { error: null };
      },
      then: (resolve: (v: unknown) => void) =>
        resolve({
          data:
            table === 'audit_logs'
              ? state.rows
              : table === 'profiles'
                ? [{ id: 'u1', name: 'Ana', email: 'ana@x.com' }]
                : [{ id: 'o1', name: 'Escritório A' }],
          error: null,
        }),
    });
    return b;
  };
  const client = { from: (t: string) => builder(t), auth: { getUser: async () => ({ data: { user: state.user } }) } };
  return { createClient: async () => client, createStaticAdminClient: () => client };
});

import { GET } from './events/route';
import { POST } from './login-failed/route';
import { resetAuditThrottle } from '@/lib/security/auditLog';

describe('GET /api/security/events', () => {
  beforeEach(() => {
    state.user = { id: 'u1' };
    state.role = 'super_admin';
    state.rows = [];
    state.filters = [];
    state.inserts = [];
  });

  it('recusa quem não está logado e quem não é super admin', async () => {
    state.user = null;
    expect((await GET(new Request('https://crm.test/api/security/events'))).status).toBe(401);
    state.user = { id: 'u1' };
    state.role = 'admin';
    expect((await GET(new Request('https://crm.test/api/security/events'))).status).toBe(403);
  });

  it('devolve os eventos com nome de quem fez e da organização', async () => {
    state.rows = [
      {
        id: 'e1',
        created_at: '2026-11-24T12:00:00Z',
        user_id: 'u1',
        organization_id: 'o1',
        action: 'api_key.created',
        resource_type: 'api_key',
        resource_id: null,
        details: { name: 'n8n' },
        severity: 'warning',
        ip_address: '203.0.113.7',
        user_agent: 'UA',
      },
    ];
    const res = await GET(new Request('https://crm.test/api/security/events?severity=warning&org=nao-e-uuid&period=30d'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasMore).toBe(false);
    expect(body.events[0]).toMatchObject({
      action: 'api_key.created',
      actor: { id: 'u1', name: 'Ana', email: 'ana@x.com' },
      organization: { id: 'o1', name: 'Escritório A' },
      ip: '203.0.113.7',
    });
    // filtro de gravidade aplicado; organização inválida ignorada
    expect(state.filters).toContainEqual(['eq', 'severity', 'warning']);
    expect(state.filters.some(f => f[1] === 'organization_id' && f[0] === 'eq')).toBe(false);
  });
});

describe('POST /api/security/login-failed', () => {
  const call = (email: unknown, ip = '203.0.113.50') =>
    POST(
      new Request('https://crm.test/api/security/login-failed', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ email }),
      }),
    );

  beforeEach(() => {
    state.inserts = [];
    resetAuditThrottle();
  });

  it('grava a tentativa com e-mail mascarado e sem senha', async () => {
    const res = await call('Fulano@Escritorio.com', '203.0.113.51');
    expect(res.status).toBe(204);
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]).toMatchObject({
      action: 'auth.login_failed',
      severity: 'warning',
      ip_address: '203.0.113.51',
      details: { email: 'fu***@escritorio.com' },
      user_id: null,
    });
  });

  it('no máximo um registro por minuto por IP e ignora e-mail inválido', async () => {
    await call('a@b.com', '203.0.113.52');
    await call('c@d.com', '203.0.113.52');
    await call('sem-arroba', '203.0.113.53');
    expect(state.inserts).toHaveLength(1);
  });
});
