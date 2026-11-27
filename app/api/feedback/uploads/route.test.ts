import { beforeEach, describe, expect, it, vi } from 'vitest';

const createSignedUploadUrl = vi.fn(async (path: string) => ({ data: { path, token: 'tok' }, error: null }));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));
vi.mock('@/lib/whatsapp/api', () => ({
  json: (body: unknown, status = 200) => Response.json(body, { status }),
  requireOrgUser: async () => ({ ok: true, user: { id: 'u1', organizationId: 'o1', role: 'user' },
    admin: { storage: { from: () => ({ createSignedUploadUrl }) } } }),
}));

import { POST } from './route';

const post = (body: unknown) => POST(new Request('https://crm.test/api/feedback/uploads', { method: 'POST', body: JSON.stringify(body) }));

describe('POST /api/feedback/uploads', () => {
  beforeEach(() => createSignedUploadUrl.mockClear());
  it('devolve caminho na pasta do usuário', async () => {
    const res = await post({ fileName: 'Print.png', mime: 'image/png', size: 100, kind: 'image' });
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
});
