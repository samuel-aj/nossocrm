/**
 * Membros da organização (id + nome + role) — acessível a QUALQUER usuário
 * logado, ao contrário de useOrgUsers (admin). Inclui super_admins (agência).
 * Usado pra exibir/atribuir o responsável de um lead.
 */
import { useQuery } from '@tanstack/react-query';

export interface OrgMember {
  id: string;
  name: string;
  role: string;
}

export const useOrgMembers = () => {
  return useQuery<OrgMember[]>({
    queryKey: ['orgMembers'],
    queryFn: async () => {
      const res = await fetch('/api/org/members', {
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      const json = (await res.json().catch(() => ({}))) as { members?: OrgMember[]; error?: string };
      if (!res.ok) throw new Error(json.error || 'Falha ao carregar usuários');
      return json.members ?? [];
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
};
