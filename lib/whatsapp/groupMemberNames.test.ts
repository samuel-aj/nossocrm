import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeGroupParticipants } from './groupParticipants';
import { withGroupSenderNames } from './groupMemberNames';

it('uses a named inbound sender from the same group without requiring a CRM contact', async () => {
  const members = normalizeGroupParticipants([
    { id: '5511999999999@s.whatsapp.net', name: '+55 (11) 99999-9999' },
    { id: '5511999999998@s.whatsapp.net', name: 'Maria' }, { id: '123456789@lid' },
  ]);
  const q = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({ data: [{ from_phone: '+5511999999999', sender_name: 'Ana' }, { from_phone: '+5511999999999', sender_name: 'Antigo' }] }) };
  const admin = { from: vi.fn(() => q) };
  const named = await withGroupSenderNames(admin as unknown as SupabaseClient, 'org', 'group', members);
  expect(q.eq.mock.calls).toEqual([['organization_id', 'org'], ['conversation_id', 'group'], ['direction', 'in']]);
  expect(named.map(m => m.name)).toEqual(['Ana', 'Maria', '']);
  expect(named[2].phone).toBeNull();
});
describe('provider names', () => {
  it('uses pushName when the first name is just a number and preserves it across duplicate entries', () => {
    const id = '5511999999999@s.whatsapp.net';
    expect(normalizeGroupParticipants([{ id, name: '5511999999999', pushName: 'Joana' }, { id }])).toEqual([
      { id, phone: '+5511999999999', name: 'Joana', admin: false },
    ]);
  });
});
