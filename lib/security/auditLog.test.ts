import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  logSecurityEvent,
  logSuperAdminAction,
  maskEmail,
  requestMeta,
  resetAuditThrottle,
  sanitizeAuditDetails,
  shouldLogThrottled,
} from './auditLog';

function fakeClient(result: { error: unknown } | Error = { error: null }) {
  const insert = vi.fn(async (_row: Record<string, unknown>) => {
    if (result instanceof Error) throw result;
    return result;
  });
  const from = vi.fn((_table: string) => ({ insert }));
  return { client: { from } as unknown as SupabaseClient, from, insert };
}

const req = (headers: Record<string, string>) => new Request('https://crm.test/api/x', { headers });

describe('registro de eventos críticos', () => {
  beforeEach(() => resetAuditThrottle());
  afterEach(() => vi.restoreAllMocks());

  it('nunca guarda segredo e corta texto longo', () => {
    const out = sanitizeAuditDetails({
      email: 'a@b.com',
      api_key: 'sk-123',
      metaToken: 'EAAG',
      senha: 'x',
      nested: { password: 'p', ok: true },
      long: 'y'.repeat(500),
      tokenSet: true,
    }) as Record<string, unknown>;
    expect(out.email).toBe('a@b.com');
    expect(out.api_key).toBe('[oculto]');
    expect(out.metaToken).toBe('[oculto]');
    expect(out.senha).toBe('[oculto]');
    expect((out.nested as Record<string, unknown>).password).toBe('[oculto]');
    expect((out.nested as Record<string, unknown>).ok).toBe(true);
    expect(JSON.stringify(out)).not.toContain('sk-123');
    expect((out.long as string).length).toBeLessThan(310);
    // booleano com nome de segredo ("token definido?") não é segredo
    expect(out.tokenSet).toBe(true);
  });

  it('lê IP e navegador da requisição', () => {
    expect(requestMeta(req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'user-agent': 'UA' }))).toEqual({
      ip: '203.0.113.7',
      userAgent: 'UA',
    });
    expect(requestMeta(req({ 'x-real-ip': '198.51.100.2' })).ip).toBe('198.51.100.2');
    expect(requestMeta(null)).toEqual({ ip: null, userAgent: null });
  });

  it('mascara e-mail', () => {
    expect(maskEmail('fulano@escritorio.com')).toBe('fu***@escritorio.com');
    expect(maskEmail('semarroba')).toBe('***');
    expect(maskEmail(null)).toBeNull();
  });

  it('limita eventos repetidos por chave e janela', () => {
    expect(shouldLogThrottled('k', 60_000, 1_000)).toBe(true);
    expect(shouldLogThrottled('k', 60_000, 30_000)).toBe(false);
    expect(shouldLogThrottled('outra', 60_000, 30_000)).toBe(true);
    expect(shouldLogThrottled('k', 60_000, 61_001)).toBe(true);
  });

  it('grava o evento com quem, onde, IP e detalhes limpos', async () => {
    const { client, from, insert } = fakeClient();
    await logSecurityEvent(
      {
        action: 'api_key.created',
        actorId: 'u1',
        organizationId: 'o1',
        resourceType: 'api_key',
        resourceId: '8f14e45f-ceea-4f6a-9fd3-1c2b3a4d5e6f',
        details: { name: 'n8n', token: 'segredo' },
        severity: 'warning',
      },
      req({ 'x-forwarded-for': '203.0.113.7', 'user-agent': 'UA' }),
      client,
    );
    expect(from).toHaveBeenCalledWith('audit_logs');
    expect(insert).toHaveBeenCalledWith({
      user_id: 'u1',
      organization_id: 'o1',
      action: 'api_key.created',
      resource_type: 'api_key',
      resource_id: '8f14e45f-ceea-4f6a-9fd3-1c2b3a4d5e6f',
      details: { name: 'n8n', token: '[oculto]' },
      severity: 'warning',
      ip_address: '203.0.113.7',
      user_agent: 'UA',
    });
  });

  it('id que não é UUID vai para os detalhes, não para a coluna', async () => {
    const { client, insert } = fakeClient();
    await logSecurityEvent({ action: 'team.invite.revoked', resourceType: 'invite', resourceId: 'abc' }, null, client);
    const row = insert.mock.calls[0][0];
    expect(row.resource_id).toBeNull();
    expect(row.details).toEqual({ resource_ref: 'abc' });
    expect(row.severity).toBe('info');
    expect(row.user_id).toBeNull();
  });

  it('falha de gravação nunca derruba a operação', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      logSecurityEvent({ action: 'data.contacts.exported', resourceType: 'contacts' }, null, fakeClient(new Error('boom')).client),
    ).resolves.toBeUndefined();
    await expect(
      logSecurityEvent(
        { action: 'data.contacts.exported', resourceType: 'contacts' },
        null,
        fakeClient({ error: { code: '42501', message: 'denied' } }).client,
      ),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('ação de super admin continua gravando, agora com IP', async () => {
    const { client, insert } = fakeClient();
    await logSuperAdminAction(
      client,
      {
        action: 'superadmin.user.password_reset',
        actor_id: 'sa',
        org_id: 'o1',
        resource_type: 'user',
        details: { email: 'x@y.com' },
      },
      req({ 'x-forwarded-for': '203.0.113.9' }),
    );
    expect(insert.mock.calls[0][0]).toMatchObject({
      user_id: 'sa',
      organization_id: 'o1',
      action: 'superadmin.user.password_reset',
      severity: 'warning',
      ip_address: '203.0.113.9',
    });
  });
});
