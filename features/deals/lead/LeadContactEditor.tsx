"use client";

import React, { useEffect, useId, useState } from "react";
import { Check, Search } from "lucide-react";
import { useContactsPaginated } from "@/lib/query/hooks";
import type { Contact } from "@/types";

type Props = {
  currentContactId: string;
  saving?: boolean;
  onSave: (contact: Contact) => Promise<boolean>;
  onCancel: () => void;
};

/** Searches the full visible contact base, including contacts outside the CRM list cache. */
export function LeadContactEditor({ currentContactId, saving = false, onSave, onCancel }: Props) {
  const inputId = useId();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [selected, setSelected] = useState<Contact | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const contacts = useContactsPaginated({ pageIndex, pageSize: 10 }, { search: query, excludeDeleted: true });
  const busy = pending || saving;
  const waitingForSearch = search.trim() !== query;
  const staleResults = waitingForSearch || contacts.isPlaceholderData;

  useEffect(() => {
    if (search.trim() === query) return;
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPageIndex(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [search, query]);

  const submit = async () => {
    if (!selected || selected.id === currentContactId || busy) return;
    setPending(true);
    setFailed(false);
    try {
      setFailed(!(await onSave(selected)));
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      className="mt-3 space-y-3 border-t border-slate-200 dark:border-white/10 pt-3"
      aria-busy={busy}
      onKeyDown={event => {
        if (event.key === "Escape") {
          event.stopPropagation();
          if (!busy) onCancel();
        }
      }}
    >
      <label htmlFor={inputId} className="block text-xs font-medium text-slate-600 dark:text-slate-300">
        Buscar contato por nome, telefone ou email
      </label>
      <div className="relative">
        <Search size={15} aria-hidden="true" className="absolute left-2.5 top-2.5 text-slate-400" />
        <input
          id={inputId}
          autoFocus
          value={search}
          disabled={busy}
          onChange={event => { setSearch(event.target.value); setSelected(null); setFailed(false); }}
          placeholder="Nome, telefone ou email"
          className="w-full rounded-lg border border-slate-300 dark:border-white/15 bg-white dark:bg-slate-900 py-2 pl-8 pr-2 text-sm focus:outline-primary-500 disabled:opacity-60"
        />
      </div>
      {contacts.isError ? (
        <div role="alert" className="space-y-1 text-xs text-red-600 dark:text-red-400">
          <p>Não foi possível buscar os contatos.</p>
          <button type="button" onClick={() => void contacts.refetch()} className="underline">Tentar novamente</button>
        </div>
      ) : contacts.isLoading || staleResults ? (
        <p role="status" className="text-xs text-slate-500">Buscando contatos…</p>
      ) : (
        <>
          <div role="group" aria-label="Contatos encontrados" className="max-h-52 space-y-1 overflow-y-auto">
            {contacts.data?.data.map(candidate => {
              const current = candidate.id === currentContactId;
              const chosen = candidate.id === selected?.id;
              return (
                <button
                    key={candidate.id}
                    type="button"
                    aria-pressed={chosen}
                    disabled={busy || current}
                    onClick={() => { setSelected(candidate); setFailed(false); }}
                    className={`w-full rounded-lg border p-2 text-left text-xs disabled:opacity-60 ${chosen ? "border-primary-500 bg-primary-50 dark:bg-primary-500/10" : "border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5"}`}
                >
                  <span className="flex items-center justify-between gap-2 font-medium">
                    <span>{candidate.name || "Sem nome"}</span>
                    {current ? <span className="text-slate-500">Atual</span> : chosen && <Check size={14} aria-hidden="true" />}
                  </span>
                  {candidate.phone && <span className="block mt-1 text-slate-500 dark:text-slate-400">{candidate.phone}</span>}
                  {candidate.email && <span className="block break-all text-slate-500 dark:text-slate-400">{candidate.email}</span>}
                </button>
              );
            })}
            {!contacts.data?.data.length && <p className="text-xs text-slate-500">Nenhum contato encontrado.</p>}
          </div>
          {(pageIndex > 0 || contacts.data?.hasMore) && (
            <div className="flex justify-between text-xs">
              <button type="button" disabled={busy || pageIndex === 0} onClick={() => setPageIndex(pageIndex - 1)} className="text-primary-600 disabled:opacity-40">Anteriores</button>
              <button type="button" disabled={busy || !contacts.data?.hasMore} onClick={() => setPageIndex(pageIndex + 1)} className="text-primary-600 disabled:opacity-40">Próximos</button>
            </div>
          )}
        </>
      )}
      {selected && <p className="text-xs text-slate-600 dark:text-slate-300">Novo contato: <strong>{selected.name}</strong></p>}
      {failed && <p role="alert" className="text-xs text-red-600 dark:text-red-400">Não foi possível trocar o contato. Tente salvar novamente.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void submit()} disabled={!selected || selected.id === currentContactId || busy} className="rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
          {busy ? "Salvando…" : "Salvar contato"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg border border-slate-300 dark:border-white/15 px-3 py-2 text-xs disabled:opacity-50">Cancelar</button>
      </div>
    </div>
  );
}
