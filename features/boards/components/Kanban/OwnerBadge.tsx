'use client';

import { useOrgUsers } from '@/lib/query/hooks';

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Mostra o avatar (iniciais) do RESPONSÁVEL de um lead a partir do `ownerId`,
 * resolvendo o nome via `useOrgUsers`. Renderiza `null` quando não há
 * responsável OU quando a lista de usuários não está disponível (ex.: usuário
 * não-admin) — sem quebrar o layout do card.
 */
export function OwnerBadge({ ownerId, showName = false }: { ownerId?: string | null; showName?: boolean }) {
  const { byId } = useOrgUsers();
  if (!ownerId) return null;
  const owner = byId.get(ownerId);
  if (!owner) return null;

  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span
        className="w-5 h-5 shrink-0 rounded-full bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300 flex items-center justify-center text-[9px] font-bold ring-1 ring-white dark:ring-slate-800"
        title={`Responsável: ${owner.name}`}
      >
        {getInitials(owner.name)}
      </span>
      {showName && <span className="text-xs text-slate-500 dark:text-slate-400 truncate">{owner.name}</span>}
    </span>
  );
}
