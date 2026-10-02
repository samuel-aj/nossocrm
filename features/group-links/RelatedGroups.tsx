"use client";
import { useId, useState } from 'react';
import Link from 'next/link';
import { Copy, ExternalLink, Users } from 'lucide-react';
import { Disclosure } from '@/components/ui/Disclosure';
import type { EntityType } from '@/lib/whatsapp/group-links/types';
import { useGroupLinks, useMutateGroupLink } from './useGroupLinks';

export function RelatedGroups({ entityType, entityId }: { entityType: EntityType; entityId: string }) {
  const query = useGroupLinks(entityType === 'deal' ? { dealId: entityId } : { contactId: entityId });
  const mutation = useMutateGroupLink();
  const id = useId();
  const [copyState, setCopyState] = useState('');
  if (!query.featureEnabled) return null;
  return <section className="rounded-xl border border-slate-200 dark:border-white/10 p-3 text-sm space-y-3" aria-label="Grupos relacionados">
    <Disclosure label="Grupos relacionados" defaultOpen>
      {query.isPending ? <p role="status" className="text-xs text-slate-500">Carregando grupos...</p> : null}
      {query.isError ? <p role="alert" className="text-xs text-red-600">{query.error.message} <button type="button" className="underline" onClick={() => void query.refetch()}>Tentar novamente</button></p> : null}
      {query.data?.enabled ? <>
        {query.data.groups.length === 0 ? <p className="text-xs text-slate-500">Nenhum grupo vinculado. Abra um grupo nos Chats para relacioná-lo.</p> : null}
        <ul className="space-y-2">{query.data.groups.map(group => <li key={group.id} className="rounded-lg bg-slate-50 dark:bg-white/5 p-2 space-y-1">
          <Link href={`/chats?conversation=${group.conversationId}`} className="flex items-center gap-2 text-primary-600 dark:text-primary-400"><Users size={15} className="shrink-0" /><span className="min-w-0 truncate">{group.name}</span><ExternalLink size={12} className="shrink-0" /></Link>
          {entityType === 'deal' ? group.isPrimary ? <span className="text-xs text-emerald-600">Principal</span> : <button type="button" disabled={mutation.isPending} className="text-xs font-medium text-primary-600 disabled:opacity-50" onClick={() => mutation.mutate({ conversationId: group.conversationId, entityType, entityId, action: 'set_primary' })}>Usar {group.name} como principal</button> : null}
        </li>)}</ul>
        {entityType === 'deal' ? <div className="mt-3 space-y-1">
          <label htmlFor={id} className="block text-xs font-medium text-slate-500">ID do grupo no WhatsApp</label>
          <div className="flex gap-2"><input id={id} readOnly value={query.data.whatsappGroupId ?? ''} placeholder="Sem grupo principal" className="w-full min-w-0 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 px-2 py-2 text-xs" />
          <button type="button" aria-label="Copiar ID do grupo" disabled={!query.data.whatsappGroupId} className="p-2 rounded hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-40" onClick={async () => { try { await navigator.clipboard.writeText(query.data?.whatsappGroupId ?? ''); setCopyState('ID copiado.'); } catch { setCopyState('Não foi possível copiar o ID.'); } }}><Copy size={14} /></button></div>
          <p className="text-xs text-slate-500">Preenchido pelo grupo principal. Ao remover o principal, escolha outro grupo para usar na integração.</p>
          {copyState ? <p role="status" className="text-xs text-slate-500">{copyState}</p> : null}
        </div> : null}
      </> : null}
      {mutation.isError ? <p role="alert" className="mt-2 text-xs text-red-600">{mutation.error.message}</p> : null}
    </Disclosure>
  </section>;
}
