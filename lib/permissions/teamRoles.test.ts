import { describe, expect, it } from 'vitest';
import { canSeeRoleLead, roleActions, TeamRoleSchema, type BoardAccess } from './teamRoles';
const boards: BoardAccess[] = [{ boardId: '11111111-1111-4111-8111-111111111111', scope: 'own', create: true, edit: false, move: true, delete: false }];
describe('per-funnel permissions', () => {
  it('own means only the owner, never unassigned or another funnel', () => {
    expect(canSeeRoleLead(boards, 'me', boards[0].boardId, 'me')).toBe(true);
    expect(canSeeRoleLead(boards, 'me', boards[0].boardId, null)).toBe(false);
    expect(canSeeRoleLead(boards, 'me', boards[0].boardId, 'other')).toBe(false);
    expect(canSeeRoleLead(boards, 'me', 'other', 'me')).toBe(false);
  });
  it('all includes unassigned only in the authorized funnel', () => {
    expect(canSeeRoleLead([{ ...boards[0], scope: 'all' }], 'me', boards[0].boardId, null)).toBe(true);
  });
  it('actions remain independent and missing access denies', () => {
    expect(roleActions(boards, boards[0].boardId).deals).toEqual({ create: true, edit: false, move: true, delete: false });
    expect(roleActions(boards, 'other').deals.create).toBe(false);
    expect(roleActions(boards).deals.create).toBe(false);
  });
  it('rejects duplicate funnels and incomplete permissions', () => {
    expect(TeamRoleSchema.safeParse({ name: 'Sales', boards: [boards[0], boards[0]] }).success).toBe(false);
    expect(TeamRoleSchema.safeParse({ name: 'Sales', boards: [{ boardId: boards[0].boardId }] }).success).toBe(false);
  });
});
