'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import type { ConnectionHistoryPage } from '@/lib/whatsapp/connectionHistory';

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

function Timestamp({ value }: { value: string }) {
  return <time dateTime={value}>{dateFormat.format(new Date(value))}</time>;
}

type Line = { connectionId: string; organizationId: string; userId: string };
const resolutionLabels = { disabled: 'Monitoramento desativado', reconnected: 'Reconexão' };

export function WhatsAppConnectionHistory({ connectionId, organizationId, userId }: Line) {
  const history = useInfiniteQuery({
    queryKey: ['waConnectionHistory', organizationId, userId, connectionId],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<ConnectionHistoryPage> => {
      const params = new URLSearchParams({ connectionId });
      if (pageParam) params.set('cursor', pageParam);
      const response = await fetch(`/api/whatsapp/connection/history?${params}`, {
        credentials: 'include', cache: 'no-store', signal,
      });
      if (!response.ok) throw Object.assign(new Error('Não foi possível carregar o histórico deste número.'), { status: response.status });
      return response.json();
    },
    getNextPageParam: page => page.nextCursor,
    staleTime: 0,
    refetchInterval: query => (query.state.data?.pages.length ?? 1) === 1 ? 30_000 : false,
    retry: false,
  });

  if (history.isPending) return <p role="status">Carregando histórico…</p>;
  const denied = history.error && 'status' in history.error && [401, 403, 404].includes(Number(history.error.status));
  if (history.isError && (!history.isFetchNextPageError || denied)) return <div role="alert">
    Não foi possível carregar o histórico deste número.{' '}
    <button type="button" onClick={() => void history.refetch()} className="font-semibold text-primary-600 underline">Tentar novamente</button>
  </div>;

  const entries = history.data?.pages.flatMap(page => page.items) ?? [];
  if (!entries.length) return <p>Nenhum incidente registrado para este número desde o início do monitoramento.</p>;
  return <>
    <ol className="divide-y divide-slate-200 dark:divide-white/10">
      {entries.map(entry => <li key={entry.id} className="space-y-1 py-3 first:pt-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-semibold text-slate-900 dark:text-white">Início · <Timestamp value={entry.openedAt} /></span>
          {entry.resolvedAt
            ? <span>{entry.resolution ? resolutionLabels[entry.resolution] : 'Encerramento'} · <Timestamp value={entry.resolvedAt} /></span>
            : <span className="font-medium text-red-700 dark:text-red-300">Em andamento</span>}
        </div>
        <p>{entry.observation}</p>
        <p>{entry.observedBy} · <Timestamp value={entry.observedAt} /></p>
        {entry.detectedBy !== entry.observedBy && <p>Detectado por {entry.detectedBy}</p>}
      </li>)}
    </ol>
    {history.isFetchNextPageError && <p role="alert">Não foi possível carregar os incidentes anteriores.</p>}
    {history.hasNextPage && <button type="button" disabled={history.isFetching} onClick={() => void history.fetchNextPage()}
      className="mt-2 rounded-md font-semibold text-primary-600 hover:underline disabled:opacity-60 dark:text-primary-300">
      {history.isFetchingNextPage ? 'Carregando…' : 'Ver incidentes anteriores'}
    </button>}
  </>;
}
