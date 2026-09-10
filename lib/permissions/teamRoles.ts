import { z } from 'zod';
import { DEFAULT_ACTION_PERMISSIONS, type ActionPermissions } from './types';

export const BoardAccessSchema = z.object({
  boardId: z.string().uuid(),
  scope: z.enum(['own', 'all']),
  create: z.boolean(), edit: z.boolean(), move: z.boolean(), delete: z.boolean(),
}).strict();
export const TeamRoleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).default(''),
  boards: z.array(BoardAccessSchema).max(200).refine(items => new Set(items.map(b => b.boardId)).size === items.length, 'Funil duplicado'),
}).strict();
export type BoardAccess = z.infer<typeof BoardAccessSchema>;
export type TeamRoleInput = z.infer<typeof TeamRoleSchema>;
export interface TeamRole extends TeamRoleInput { id: string; organization_id: string }
export const DENIED_ACTIONS: ActionPermissions = {
  contacts: { view: false, create: false, edit: false, delete: false },
  deals: { create: false, edit: false, delete: false, move: false },
};
export function canSeeRoleLead(boards: BoardAccess[], userId: string, boardId: string | null, ownerId: string | null): boolean {
  const rule = boards.find(b => b.boardId === boardId);
  return !!rule && (rule.scope === 'all' || ownerId === userId);
}
export function roleActions(boards: BoardAccess[], boardId?: string): ActionPermissions {
  const rule = boardId ? boards.find(b => b.boardId === boardId) : undefined;
  return { contacts: { ...DENIED_ACTIONS.contacts }, deals: rule ? {
    create: rule.create, edit: rule.edit, delete: rule.delete, move: rule.move,
  } : { ...DENIED_ACTIONS.deals } };
}
export function hasFullOperationalAccess(role: string, isMaster = false): boolean {
  return isMaster || role === 'admin' || role === 'super_admin';
}
export { DEFAULT_ACTION_PERMISSIONS };
