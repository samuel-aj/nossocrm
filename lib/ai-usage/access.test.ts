import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const h = vi.hoisted(() => ({ allowed: true, owner: 'user' as string | null }));
vi.mock('@/lib/permissions/conversationAccess', () => ({ conversationAllowed: async () => h.allowed }));
vi.mock('@/lib/permissions/server', () => ({ effectiveOwnersByContact: async () => new Map(h.owner ? [['contact', h.owner]] : []) }));
vi.mock('@/lib/whatsapp/api', () => ({ isOrgAdmin: (role: string) => role === 'admin' }));
import { conversationUsageAccess } from './access';
const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { contact_id: 'contact' }, error: null }) };
const admin = { from: () => query } as unknown as SupabaseClient;
const user = { id: 'user', organizationId: 'org', role: 'user' };
beforeEach(() => { h.allowed = true; h.owner = 'user'; });
describe('manual spending authority', () => {
  it('allows the effective owner, not every person who can see the conversation', async () => {
    expect(await conversationUsageAccess(admin, user, 'chat')).toEqual({ allowed: true, canGrant: true });
    h.owner = 'someone-else'; expect(await conversationUsageAccess(admin, user, 'chat')).toEqual({ allowed: true, canGrant: false });
    h.owner = null; expect((await conversationUsageAccess(admin, user, 'chat')).canGrant).toBe(false);
  });
  it('requires visibility even for admin', async () => {
    h.allowed = false; expect(await conversationUsageAccess(admin, { ...user, role: 'admin' }, 'chat')).toEqual({ allowed: false, canGrant: false });
  });
});
