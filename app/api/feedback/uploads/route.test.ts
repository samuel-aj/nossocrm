import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRateLimits } from '@/lib/security/rateLimit';

const { createSignedUploadUrl, logSecurityEvent } = vi.hoisted(() => ({
  createSignedUploadUrl: vi.fn(async (path: string) => ({ data: { path, token: 'tok' }, error: null })),
  logSecurityEvent: vi.fn(),
}));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));
vi.mock('@/lib/security/auditLog', () => ({
  logSecurityEvent, shouldLogThrottled: () => true, requestMeta: () => ({ ip: null }),
}));
vi.mock('@/lib/whatsapp/api', () => ({
  json: (body: unknown, status = 200) => Response.json(body, { status }),
  requireOrgUser: async () => ({ ok: true, user: { id: 'u1', organizationId: 'o1', role: 'user' },
    admin: { storage: { from: () => ({ createSignedUploadUrl }) } } }),
}));

import { POST } from './route';

const post = (body: unknown) => POST(new Request('https://crm.test/api/feedback/uploads', { method: 'POST', body: JSON.stringify(body) }));
const png = { fileName: 'Print.png', mime: 'image/png', size: 100, kind: 'image' };

describe('POST /api/feedback/uploads', () => {
  beforeEach(() => { createSignedUploadUrl.mockClear(); logSecurityEvent.mockClear(); resetRateLimits(); });
  it('devolve caminho na pasta do usuário', async () => {
    const res = await post(png);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.path).toMatch(/^o1\/u1\/[0-9a-f-]{36}_print\.png$/);
    expect(body.token).toBe('tok');
  });
  it('recusa tipo de arquivo não aceito', async () => {
    const res = await post({ fileName: 'a.exe', mime: 'application/x-msdownload', size: 100, kind: 'file' });
    expect(res.status).toBe(422);
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });
  it('aceita 30 pedidos de upload por minuto por usuário e recusa o 31º', async () => {
    for (let n = 0; n < 30; n++) expect((await post(png)).status).toBe(200);
    const limited = await post(png);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
    expect(createSignedUploadUrl).toHaveBeenCalledTimes(30);
    expect(logSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'rate_limit.exceeded', actorId: 'u1', details: expect.objectContaining({ limite: 'feedback_upload' }),
    }), expect.anything());
  });
});
