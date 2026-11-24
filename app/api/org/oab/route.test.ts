import { beforeEach, expect, it, vi } from 'vitest';
import { GET, POST, DELETE } from './route';
import { UserRole } from '@/types/constants';

const fake = vi.hoisted(() => ({ auth: vi.fn(), table: vi.fn(), insert: vi.fn(), remove: vi.fn() }));
vi.mock('@/lib/whatsapp/api', async original => ({
  ...await original<typeof import('@/lib/whatsapp/api')>(), requireOrgUser: fake.auth,
}));
const id = '11111111-1111-4111-8111-111111111111';
const office = '22222222-2222-4222-8222-222222222222';
const record = { professionalName: 'Ana Exemplo', state: 'MS', number: '12.345-A', confirmed: true };
function request(method: string, data: object) {
  return new Request('https://crm.example.test/api/org/oab', { method, body: JSON.stringify(data) });
}
beforeEach(() => {
  vi.resetAllMocks();
  fake.auth.mockResolvedValue({ ok: true, user: { id, organizationId: office, role: UserRole.ADMIN }, admin: { from: fake.table } });
  fake.table.mockReturnValue({ insert: fake.insert, delete: fake.remove });
  fake.insert.mockResolvedValue({ error: null });
});

it('confirma a inscrição com o escopo e o autor da sessão', async () => {
  expect((await POST(request('POST', record))).status).toBe(201);
  expect(fake.insert).toHaveBeenCalledWith({ organization_id: office, confirmed_by: id, professional_name: 'Ana Exemplo', state: 'MS', number: '12345A' });
});
it.each([{ ...record, confirmed: false }, { ...record, state: 'XX' }, { ...record, number: '000' }, { ...record, organization_id: id }])(
  'recusa uma confirmação inválida ou com escritório sobrescrito', async input => {
    expect((await POST(request('POST', input))).status).toBe(400);
    expect(fake.insert).not.toHaveBeenCalled();
  });
it('restringe a gestão aos administradores', async () => {
  fake.auth.mockResolvedValue({ ok: true, user: { role: 'vendedor' } });
  expect((await GET()).status).toBe(403);
  expect((await POST(request('POST', record))).status).toBe(403);
  expect((await DELETE(request('DELETE', { id }))).status).toBe(403);
  expect(fake.table).not.toHaveBeenCalled();
});
it('carrega apenas os registros confirmados do escritório selecionado', async () => {
  const data = { id, professionalName: 'Ana Exemplo', state: 'MS', number: '12345A' };
  const order = vi.fn().mockResolvedValue({ data: [data], error: null });
  const eq = vi.fn().mockReturnValue({ order: () => ({ order }) });
  fake.table.mockReturnValue({ select: () => ({ eq }) });
  expect(await (await GET()).json()).toEqual({ registrations: [data] });
  expect(eq).toHaveBeenCalledWith('organization_id', office);
});
it('revoga uma confirmação apenas no escritório atual', async () => {
  const byId = vi.fn().mockResolvedValue({ error: null });
  const byOrg = vi.fn().mockReturnValue({ eq: byId });
  fake.remove.mockReturnValue({ eq: byOrg });
  expect((await DELETE(request('DELETE', { id }))).status).toBe(200);
  expect(byOrg).toHaveBeenCalledWith('organization_id', office);
  expect(byId).toHaveBeenCalledWith('id', id);
});
