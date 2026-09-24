'use client';
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal } from '@/components/ui/Modal';
import type { GroupParticipant } from '@/lib/whatsapp/groupParticipants';

export function useGroupMembers(conversationId: string | null, enabled: boolean) {
  return useQuery<{ participants: GroupParticipant[]; connectionId: string }>({
    queryKey: ['waGroupParticipants', conversationId], enabled: !!conversationId && enabled,
    staleTime: 30_000, retry: false,
    queryFn: async () => {
      const response = await fetch(`/api/whatsapp/groups/participants?conversationId=${encodeURIComponent(conversationId!)}`, { credentials: 'include' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Não foi possível consultar o grupo.');
      return body;
    },
  });
}

export function GroupMembersModal({ name, members, loading, error, onClose, onOpenChat, onRetry }: {
  name: string; members: GroupParticipant[]; loading: boolean; error: string | null;
  onClose: () => void; onRetry: () => void; onOpenChat?: (member: GroupParticipant) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = members.filter(m => `${m.name} ${m.phone || ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <Modal isOpen onClose={onClose} title={`Participantes de ${name}`} size="md">
    <input aria-label="Buscar participante" placeholder="Buscar nome ou telefone..." value={search} onChange={e => setSearch(e.target.value)} className="mb-3 w-full rounded-lg border border-slate-200 dark:border-white/10 bg-transparent px-3 py-2 text-sm" />
    {loading && <p role="status">Carregando participantes...</p>}
    {error && <div role="alert" className="text-sm text-amber-600">{error}<button type="button" onClick={onRetry} className="ml-2 underline">Tentar novamente</button></div>}
    {!loading && !error && <><p className="mb-2 text-xs text-slate-500">{members.length} participantes</p>
      <ul className="space-y-2">{filtered.map(m => <li key={m.id} className="flex items-center gap-3 rounded-lg border border-slate-200 dark:border-white/10 p-3">
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{m.name}</p><p className="text-xs text-slate-500">{m.phone || 'Telefone não disponibilizado'}{m.admin && ' · Administrador'}</p></div>
        {onOpenChat && <button type="button" disabled={!m.phone} title={!m.phone ? 'O WhatsApp não disponibilizou o telefone deste participante.' : undefined} onClick={() => onOpenChat(m)} className="shrink-0 rounded-lg px-2 py-1 text-xs text-emerald-600 hover:bg-emerald-50 dark:hover:bg-white/5 disabled:opacity-40">Abrir conversa</button>}
      </li>)}</ul>{!filtered.length && <p className="text-sm text-slate-500">Nenhum participante encontrado.</p>}</>}
  </Modal>;
}

export function MentionSuggestions({ members, activeIndex, loading, error, onSelect }: {
  members: GroupParticipant[]; activeIndex: number; loading: boolean; error: string | null; onSelect: (m: GroupParticipant) => void;
}) {
  return <div id="group-mention-list" role="listbox" aria-label="Mencionar participante" className="absolute bottom-full left-0 right-0 z-30 mb-1 max-h-52 overflow-y-auto rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 p-1 shadow-xl">
    {loading ? <p role="status" className="p-2 text-xs">Carregando participantes...</p> : error ? <p className="p-2 text-xs text-amber-600">{error}</p> : members.length ? members.map((m, i) => <button type="button" role="option" aria-selected={i === activeIndex} id={`group-mention-${i}`} key={m.id} onMouseDown={e => e.preventDefault()} onClick={() => onSelect(m)} className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${i === activeIndex ? 'bg-emerald-50 dark:bg-emerald-900/40' : ''}`}>
      <span className="font-semibold">{m.name}</span><span className="ml-2 text-xs text-slate-500">{m.phone}</span>
    </button>) : <p className="p-2 text-xs text-slate-500">Nenhum participante encontrado.</p>}
  </div>;
}
