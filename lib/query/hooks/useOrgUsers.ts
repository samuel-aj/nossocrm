/**
 * Hook para listar os usuários da organização ativa (admins + vendedores),
 * usado para escolher/mostrar o RESPONSÁVEL de um lead.
 *
 * Busca `GET /api/admin/users` (restrito a admin/super_admin no servidor) e só
 * é habilitado para admin/super_admin — para vendedor fica desabilitado (não
 * dispara request nem 403), então o seletor/badge simplesmente não aparece.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';

export interface OrgUser {
  id: string;
  email: string | null;
  role: string;
  first_name?: string | null;
  last_name?: string | null;
  nickname?: string | null;
  /** Nome de exibição derivado (nickname → nome completo → email). */
  name: string;
}

function displayName(u: {
  first_name?: string | null;
  last_name?: string | null;
  nickname?: string | null;
  email?: string | null;
}): string {
  const full = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
  return u.nickname || full || u.email || 'Usuário';
}

export const useOrgUsers = () => {
  const { user, profile, loading: authLoading } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';

  const query = useQuery({
    queryKey: ['orgUsers', profile?.organization_id ?? null],
    queryFn: async (): Promise<OrgUser[]> => {
      const res = await fetch('/api/admin/users', {
        headers: { accept: 'application/json' },
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((json as { error?: string }).error || 'Falha ao carregar usuários');
      }
      const raw = ((json as { users?: Array<Omit<OrgUser, 'name'>> }).users || []);
      return raw.map((u) => ({ ...u, name: displayName(u) }));
    },
    enabled: !authLoading && !!user && isAdmin,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const users = useMemo(() => query.data || [], [query.data]);
  const byId = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  return { ...query, users, byId, isAdmin };
};
