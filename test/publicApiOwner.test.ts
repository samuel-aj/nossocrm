import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveOwnerId } from '@/lib/public-api/resolve';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createStaticAdminClient: () => ({ from }) }));
const ownerId = '18f8b268-0f0c-499d-b2d0-001916e48168';
const org = '0d1c32d7-1e99-40fd-8813-8fa6b4b5785d';
function result(data: unknown, error: unknown = null) {
  const query = { select: vi.fn(), eq: vi.fn(), ilike: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data, error }) };
  for (const method of ['select', 'eq', 'ilike', 'limit'] as const) query[method].mockReturnValue(query);
  from.mockReturnValueOnce(query);
  return query;
}
describe('Public API owner membership', () => {
  beforeEach(() => vi.resetAllMocks());
  it('keeps an omitted owner unassigned', async () => {
    expect(await resolveOwnerId({ organizationId: org })).toEqual({ ok: true, ownerId: null });
    expect(from).not.toHaveBeenCalled();
  });
  it('accepts a regular profile active in the organization', async () => {
    result({ id: ownerId, organization_id: org, role: 'vendedor' });
    expect(await resolveOwnerId({ organizationId: org, ownerId })).toEqual({ ok: true, ownerId });
    expect(from).toHaveBeenCalledTimes(1);
  });
  it.each([{ ownerId }, { ownerEmail: 'andressamacario@anunciojuridico.com.br' }])('accepts an existing membership while another workspace is active: %j', async (owner) => {
    result({ id: ownerId, organization_id: 'another-org', role: 'vendedor' });
    const membership = result({ user_id: ownerId });
    expect(await resolveOwnerId({ organizationId: org, ...owner })).toEqual({ ok: true, ownerId });
    expect(from).toHaveBeenNthCalledWith(2, 'user_organizations');
    expect(membership.eq).toHaveBeenCalledWith('organization_id', org);
    expect(membership.eq).toHaveBeenCalledWith('user_id', ownerId);
  });
  it('rejects a profile without membership in the requested organization', async () => {
    result({ id: ownerId, organization_id: 'another-org', role: 'admin' });
    result(null);
    expect(await resolveOwnerId({ organizationId: org, ownerId })).toMatchObject({ ok: false });
  });
  it.each([false, true])('requires explicit membership for super admins: linked=%s', async (linked) => {
    result({ id: ownerId, organization_id: org, role: 'super_admin' });
    result(linked ? { user_id: ownerId } : null);
    expect((await resolveOwnerId({ organizationId: org, ownerId })).ok).toBe(linked);
  });
  it('rejects an unknown email without querying memberships', async () => {
    result(null);
    expect(await resolveOwnerId({ organizationId: org, ownerEmail: 'unknown@example.invalid' })).toMatchObject({ ok: false });
    expect(from).toHaveBeenCalledTimes(1);
  });
  it('treats email pattern characters literally', async () => {
    const profile = result(null);
    await resolveOwnerId({ organizationId: org, ownerEmail: 'A_B%test@example.invalid' });
    expect(profile.ilike).toHaveBeenCalledWith('email', 'A\\_B\\%test@example.invalid');
  });
  it('does not grant membership when its lookup fails', async () => {
    result({ id: ownerId, organization_id: 'another-org', role: 'vendedor' });
    result(null, new Error('database unavailable'));
    await expect(resolveOwnerId({ organizationId: org, ownerId })).rejects.toThrow('database unavailable');
  });
});
