import { describe, expect, it } from 'vitest';
import { normalizeGroupParticipants, reconcileMentions, resolveGroupMentions } from './groupParticipants';
const members = normalizeGroupParticipants({ participants: [{ id: '5511999990000@s.whatsapp.net', name: 'Maria', admin: 'admin' }, { id: '123456789@lid', name: 'João' }, { id: '987654321@lid', phoneNumber: '5511888880000@s.whatsapp.net', name: 'Lia' }] });
describe('group identities and mentions', () => {
  it('distinguishes LIDs from telephone numbers and preserves admin status', () => {
    expect(members[0]).toMatchObject({ name: 'Maria', phone: '+5511999990000', admin: true });
    expect(members[1]).toMatchObject({ id: '123456789@lid', phone: null });
    expect(members[2].phone).toBe('+5511888880000');
  });
  it('rejects malformed provider responses and ignores non-member JIDs', () => {
    expect(() => normalizeGroupParticipants({ status: 'failure' })).toThrow();
    expect(normalizeGroupParticipants([{ id: '12@g.us' }, { id: 'x@lid' }])).toEqual([]);
  });
  it('converts named text spans to genuine provider mention payload', () => {
    const text = 'Olá @Maria e @João';
    expect(resolveGroupMentions(text, [{ id: members[0].id, start: 4, end: 10 }, { id: members[1].id, start: 13, end: 18 }], members)).toEqual({ text: 'Olá @5511999990000 e @123456789', mentioned: [members[0].id, members[1].id] });
  });
  it('rejects recipients outside the group and malformed/overlapping spans', () => {
    expect(() => resolveGroupMentions('@Other', [{ id: 'outsider', start: 0, end: 6 }], members)).toThrow();
    expect(() => resolveGroupMentions('@Maria', [{ id: members[0].id, start: 0, end: 6 }, { id: members[1].id, start: 1, end: 5 }], members)).toThrow();
  });
  it('removes edited mention tokens and shifts preserved spans when inserting text', () => {
    const spans = [{ id: members[0].id, start: 3, end: 9 }];
    expect(reconcileMentions('Oi @Maria', 'Olá, Oi @Maria', spans)).toEqual([{ ...spans[0], start: 8, end: 14 }]);
    expect(reconcileMentions('Oi @Maria', 'Oi @Mara', spans)).toEqual([]);
    expect(reconcileMentions('Oi @Maria', '', spans)).toEqual([]);
  });
});
