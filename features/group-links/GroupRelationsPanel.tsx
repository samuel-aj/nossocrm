"use client";
import { useDeferredValue, useState } from 'react';
import Link from 'next/link';
import { Disclosure } from '@/components/ui/Disclosure';
import type { EntityType, GroupLinkEntity } from '@/lib/whatsapp/group-links/types';
import { useGroupLinks, useGroupLinkOptions, useMutateGroupLink } from './useGroupLinks';

function RelationChoices({ conversationId, type, linked }: { conversationId: string; type: EntityType; linked: GroupLinkEntity[] }) {
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search);
  const options = useGroupLinkOptions(conversationId, type, deferred, true);
  const mutation = useMutateGroupLink();
  const label = type === 'contact' ? 'Contatos' : 'Leads';
  return <div className="space-y-2">
    <h3 className="text-xs font-semibold text-slate-500">{label} relacionados · {linked.length}</h3>
    <ul className="space-y-1">{linked.map(entity => <li key={entity.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 dark:bg-white/5 p-2">
      <Link href={type === 'contact' ? `/contacts?contactId=${entity.id}` : `/boards?deal=${entity.id}`} className="min-w-0 truncate text-primary-600 dark:text-primary-400 text-sm">{entity.name}</Link>
      <button type="button" aria-label={`Desvincular ${entity.name}`} disabled={mutation.isPending} className="text-xs text-slate-500 disabled:opacity-50" onClick={() => mutation.mutate({ conversationId, entityType: type, entityId: entity.id, action: 'unlink' })}>Desvincular</button>
    </li>)}</ul>
    <input aria-label={`Buscar ${label.toLowerCase()} para vincular`} value={search} onChange={event => setSearch(event.target.value)} placeholder={`Buscar ${label.toLowerCase()}...`} className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 px-3 py-2 text-sm" />
    {options.isPending ? <p role="status" className="text-xs text-slate-500">Buscando...</p> : null}
    {options.isError ? <p role="alert" className="text-xs text-red-600">{options.error.message} <button type="button" className="underline" onClick={() => void options.refetch()}>Tentar novamente</button></p> : null}
    {options.data?.items.length === 0 ? <p className="text-xs text-slate-500">Nenhum resultado disponível.</p> : null}
    <ul className="max-h-40 overflow-y-auto space-y-1">{options.data?.items.filter(entity => !linked.some(item => item.id === entity.id)).map(entity => <li key={entity.id}><button type="button" aria-label={`Vincular ${entity.name}`} disabled={mutation.isPending || deferred !== search} className="w-full flex items-center justify-between gap-2 text-left rounded-lg p-2 text-sm hover:bg-primary-50 dark:hover:bg-white/5 disabled:opacity-50" onClick={() => mutation.mutate({ conversationId, entityType: type, entityId: entity.id, action: 'link' })}><span className="truncate">{entity.name}</span><span className="text-xs text-primary-600">Vincular</span></button></li>)}</ul>
    {mutation.isError ? <p role="alert" className="text-xs text-red-600">{mutation.error.message}</p> : null}
  </div>;
}
export function GroupRelationsPanel({ conversationId }: { conversationId: string }) {
  const query = useGroupLinks({ conversationId });
  if (!query.featureEnabled) return null;
  return <div className="border-b border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card px-4 py-3">
    <Disclosure label="Relacionados no CRM">
      <div className="space-y-3 max-h-[min(50vh,420px)] overflow-y-auto">
        <p className="text-xs text-slate-500">Vincule contatos e leads que usam este grupo. Os participantes não são vinculados automaticamente.</p>
        {query.isPending ? <p role="status" className="text-xs text-slate-500">Carregando vínculos...</p> : null}
        {query.isError ? <p role="alert" className="text-xs text-red-600">{query.error.message} <button type="button" className="underline" onClick={() => void query.refetch()}>Tentar novamente</button></p> : null}
        {query.data?.enabled ? <div className="grid gap-4 md:grid-cols-2"><RelationChoices conversationId={conversationId} type="contact" linked={query.data.contacts} /><RelationChoices conversationId={conversationId} type="deal" linked={query.data.deals} /></div> : null}
      </div>
    </Disclosure>
  </div>;
}
