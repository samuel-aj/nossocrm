'use client';
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { type ActionPermissions } from './types';
import { DENIED_ACTIONS, type BoardAccess } from './teamRoles';
interface MyPermissions { fullAccess: boolean; boards: BoardAccess[]; actions: ActionPermissions }
const observedAccess = new WeakMap<object, string>();
export function useMyActionPermissions(boardId?: string): ActionPermissions {
  const { organizationId, user, refreshProfile } = useAuth();
  const client = useQueryClient();
  const { data, isError } = useQuery({
    queryKey: ['permissions', 'me', organizationId, user?.id],
    enabled: !!organizationId && !!user,
    queryFn: async (): Promise<MyPermissions> => {
      const res = await fetch('/api/permissions/me', { credentials: 'include', cache: 'no-store' });
      if (!res.ok) throw new Error('Falha ao consultar permissões');
      return res.json();
    },
    staleTime: 10_000, refetchInterval: 15_000, refetchOnWindowFocus: 'always', retry: 1,
  });
  useEffect(() => {
    const next = JSON.stringify([organizationId, user?.id, isError ? null : data]);
    if (observedAccess.has(client) && observedAccess.get(client) !== next) {
      void client.resetQueries({ predicate: q => q.queryKey[0] !== 'permissions' });
      void refreshProfile?.();
    }
    observedAccess.set(client, next);
  }, [data, isError, organizationId, user?.id, client, refreshProfile]);
  if (isError || !data) return DENIED_ACTIONS;
  if (data.fullAccess) return data.actions;
  const rule = data.boards.find(b => b.boardId === boardId);
  return { contacts: data.actions.contacts, deals: rule ? {
    create: rule.create, edit: rule.edit, move: rule.move, delete: rule.delete,
  } : DENIED_ACTIONS.deals };
}
