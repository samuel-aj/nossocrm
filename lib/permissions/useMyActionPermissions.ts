'use client';

/**
 * Permissões de AÇÃO do usuário logado (GET /api/permissions/me), para a
 * interface esconder/desabilitar botões. Enquanto carrega (ou em erro), tudo
 * fica liberado na tela — a imposição real é no banco, que recusa a escrita
 * com mensagem clara; aqui é só pra não oferecer o que vai ser negado.
 */
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_ACTION_PERMISSIONS, type ActionPermissions } from './types';

export function useMyActionPermissions(): ActionPermissions {
  const { data } = useQuery({
    queryKey: ['permissions', 'me'],
    queryFn: async (): Promise<ActionPermissions> => {
      const res = await fetch('/api/permissions/me', { credentials: 'include' });
      if (!res.ok) return DEFAULT_ACTION_PERMISSIONS;
      const body = (await res.json().catch(() => null)) as { actions?: ActionPermissions } | null;
      return body?.actions ?? DEFAULT_ACTION_PERMISSIONS;
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
  return data ?? DEFAULT_ACTION_PERMISSIONS;
}
