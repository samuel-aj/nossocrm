import { beforeEach, expect, it, vi } from 'vitest';
import { PATCH } from './route';

const mock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock('@/lib/whatsapp/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/whatsapp/api')>(), requireOrgUser: mock.auth }));
const connectionId = '10000000-0000-4000-8000-100000000001';
const ownerId = '20000000-0000-4000-8000-100000000002';
const request = (owner: string | null) => new Request('https://crm.example/api/whatsapp/connection/alert-owner', {
  method: 'PATCH', headers: { Origin: 'https://crm.example' }, body: JSON.stringify({ connectionId, ownerId: owner }),
});

function setup(role: string, isMember = false) {
  const line = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: connectionId } }) };
  const member = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), neq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: isMember ? { user_id: ownerId } : null }) };
  const from = vi.fn((table: string) => table === 'wa_connections' ? line : member);
  mock.auth.mockResolvedValue({ ok: true, admin: { from }, user: { role, organizationId: 'office' } });
  return { from, line };
}

beforeEach(() => vi.clearAllMocks());
it('permite ao administrador remover o responsável apenas da linha no escritório atual', async () => {
  const { line } = setup('admin');
  expect((await PATCH(request(null))).status).toBe(200);
  expect(line.update).toHaveBeenCalledWith({ health_alert_owner_id: null });
  expect(line.eq.mock.calls).toEqual([['id', connectionId], ['organization_id', 'office']]);
});
it('recusa responsável sem vínculo e vendedor que tenta alterar a configuração', async () => {
  const admin = setup('admin');
  expect((await PATCH(request(ownerId))).status).toBe(422);
  expect(admin.line.update).not.toHaveBeenCalled();
  const sales = setup('vendedor', true);
  expect((await PATCH(request(ownerId))).status).toBe(403);
  expect(sales.from).not.toHaveBeenCalled();
});
