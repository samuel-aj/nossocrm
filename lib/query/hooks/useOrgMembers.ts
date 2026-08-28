/**
 * Membros da organização (id + nome + role + member) — acessível a QUALQUER
 * usuário logado, ao contrário de useOrgUsers (admin). Inclui super_admins
 * (agência) para resolver NOMES; só quem tem `member: true` (org ativa aqui
 * ou vínculo explícito) pode ser escolhido como responsável.
 * Usado pra exibir/atribuir o responsável de um lead ou atividade.
 */
import { useQuery } from '@tanstack/react-query';

export interface OrgMember {
  id: string;
  name: string;
  /** Papel NESTA org (vínculo) ou 'super_admin' quando não é membro */
  role: string;
  /** true = pertence à org (pode ser responsável); false = só nome (super admin visitando) */
  member: boolean;
  isSuperAdmin?: boolean;
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
