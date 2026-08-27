'use client';

/**
 * Modal "Encaminhar mensagem" (estilo WhatsApp): lista as conversas de
 * WhatsApp da organização (todas as conexões) e os contatos com telefone,
 * com busca por nome ou número; seleção múltipla; envia pela rota
 * POST /api/whatsapp/forward.
 *
 * Conversa presa a um número conectado sai por ELE; contato sem conversa (ou
 * conversa de número que caiu) sai pelo número padrão do chat de origem.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Check, Forward, Loader2, MessageCircle, Search, Users, X } from 'lucide-react';
import { useCRM } from '@/context/CRMContext';
import { brPhoneVariants, normalizePhoneE164 } from '@/lib/phone';
import { quotedPreviewText } from '@/lib/whatsapp/quote';
import {
  forwardWhatsAppMessages,
  type ForwardResult,
  type WaChatMessage,
  type WaSender,
} from './useWhatsAppChat';

type ConvRow = {
  id: string;
  connection_id: string | null;
  wa_phone: string;
  wa_name: string | null;
  contact_id: string | null;
  last_message_at: string | null;
  /** GRUPO do WhatsApp (só vem quando a org ligou grupos) */
  is_group?: boolean | null;
  participants_count?: number | null;
};

interface Recipient {
  key: string;
  phone: string;
  name: string;
  /** Número conectado da conversa (null = contato sem conversa) */
  connectionId: string | null;
  hasConversation: boolean;
  /** GRUPO: destino pelo id da conversa */
  conversationId?: string;
  isGroup?: boolean;
  participantsCount?: number | null;
}

const MAX_LISTED = 200;

/** Chave única por telefone: junta as grafias BR com/sem o nono dígito. */
function phoneKey(phone: string): string {
  const variants = brPhoneVariants(phone);
  if (variants.length === 0) return phone;
  return variants.slice().sort((a, b) => b.length - a.length)[0];
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function ForwardMessageModal({
  messages,
  defaultConnectionId,
  senders,
  onClose,
  onDone,
}: {
  /** Mensagens a encaminhar (em ordem) */
  messages: WaChatMessage[];
  /** Por qual número sai quando o destino não tem conversa presa a um número */
  defaultConnectionId: string | null;
  senders: WaSender[];
  onClose: () => void;
  /** Tudo enviado com sucesso */
  onDone: (result: ForwardResult) => void;
}) {
  const { contacts } = useCRM();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Map<string, Recipient>>(new Map());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState<ForwardResult | null>(null);

  const convsQ = useQuery<{ data: ConvRow[] }>({
    queryKey: ['waConversations', 'forward'],
    queryFn: async () => {
      const res = await fetch('/api/whatsapp/conversations', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const recipients = useMemo<Recipient[]>(() => {
    const byKey = new Map<string, Recipient>();
    const contactById = new Map(contacts.map(c => [c.id, c]));
    // conversas primeiro (a rota já devolve da mais recente pra mais antiga)
    for (const c of convsQ.data?.data ?? []) {
      if (c.is_group) {
        // grupo: sem telefone, o destino é a própria conversa
        byKey.set(`group#${c.id}`, {
          key: `group#${c.id}`,
          phone: '',
          name: (c.wa_name || '').trim() || 'Grupo',
          connectionId: c.connection_id,
          hasConversation: true,
          conversationId: c.id,
          isGroup: true,
          participantsCount: c.participants_count ?? null,
        });
        continue;
      }
      const phone = normalizePhoneE164(c.wa_phone);
      if (!phone) continue;
      const key = phoneKey(phone);
      if (byKey.has(key)) continue;
      const contact = c.contact_id ? contactById.get(c.contact_id) : undefined;
      byKey.set(key, {
        key,
        phone,
        name: contact?.name || c.wa_name || phone,
        connectionId: c.connection_id,
        hasConversation: true,
      });
    }
    // depois os contatos do CRM com telefone e sem conversa
    const rest: Recipient[] = [];
    for (const c of contacts) {
      const phone = normalizePhoneE164(c.phone);
      if (!phone) continue;
      const key = phoneKey(phone);
      if (byKey.has(key)) continue;
      const r: Recipient = { key, phone, name: c.name || phone, connectionId: null, hasConversation: false };
      byKey.set(key, r);
      rest.push(r);
    }
    rest.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    const convs = Array.from(byKey.values()).filter(r => r.hasConversation);
    return [...convs, ...rest];
  }, [contacts, convsQ.data]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return recipients;
    const nq = norm(q);
    const digits = q.replace(/\D/g, '');
    return recipients.filter(r => norm(r.name).includes(nq) || (digits.length > 0 && r.phone.replace(/\D/g, '').includes(digits)));
  }, [recipients, query]);

  const senderLabel = (connectionId: string | null): string | null => {
    if (!connectionId || senders.length <= 1) return null;
    const s = senders.find(x => x.id === connectionId);
    return s ? s.profileName || s.phoneNumber || 'Número' : null;
  };

  const toggle = (r: Recipient) => {
    setSelected(prev => {
      const next = new Map(prev);
      if (next.has(r.key)) next.delete(r.key);
      else next.set(r.key, r);
      return next;
    });
  };

  // Escape fecha (fora do envio)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !sending) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, sending]);

  const submit = async () => {
    if (selected.size === 0 || sending) return;
    setSending(true);
    setError(null);
    try {
      const targets = Array.from(selected.values()).map(r =>
        r.isGroup
          ? { phone: '', conversationId: r.conversationId }
          : {
              phone: r.phone,
              // conversa de número que ainda está conectado sai por ele; senão, pelo padrão do chat
              connectionId:
                r.connectionId && senders.some(s => s.id === r.connectionId) ? r.connectionId : defaultConnectionId,
            }
      );
      const result = await forwardWhatsAppMessages(
        messages.map(m => m.id),
        targets
      );
      if (result.ok) {
        onDone(result);
      } else {
        setPartial(result);
      }
    } catch (e) {
      setError((e as Error).message || 'Falha ao encaminhar');
    } finally {
      setSending(false);
    }
  };

  if (typeof document === 'undefined') return null;

  const preview = messages.length === 1 ? quotedPreviewText(messages[0]) : `${messages.length} mensagens`;
  const failures = (partial?.results ?? []).filter(r => !r.ok);
  const nameOf = (f: { phone: string; conversationId?: string | null }) =>
    (f.conversationId
      ? recipients.find(r => r.conversationId === f.conversationId)?.name
      : recipients.find(r => r.phone && phoneKey(r.phone) === phoneKey(f.phone))?.name) || f.phone;

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      onMouseDown={e => {
        if (e.target === e.currentTarget && !sending) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Encaminhar mensagem"
    >
      <div className="w-full sm:max-w-md max-h-[90vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-white dark:bg-dark-card shadow-2xl border border-slate-200 dark:border-white/10 overflow-hidden">
        {/* Cabeçalho */}
        <div className="shrink-0 flex items-start gap-3 px-4 py-3 border-b border-slate-200 dark:border-white/10">
          <span className="mt-0.5 w-8 h-8 rounded-full bg-sky-100 dark:bg-sky-900/40 text-sky-600 dark:text-sky-300 flex items-center justify-center shrink-0">
            <Forward size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-900 dark:text-white">
              Encaminhar {messages.length === 1 ? 'mensagem' : `${messages.length} mensagens`}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate" title={preview}>
              {preview}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-50"
            aria-label="Fechar"
          >
            <X size={16} />
          </button>
        </div>

        {partial ? (
          /* Parte falhou: mostra quem não recebeu e por quê */
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-custom px-4 py-3 space-y-2">
            <div className="flex items-start gap-2 rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-900/15 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>
                Encaminhada para {partial.results.filter(r => r.ok).length} de {partial.results.length} contatos. Não foi
                possível enviar para:
              </span>
            </div>
            <ul className="space-y-1.5">
              {failures.map(f => (
                <li key={`${f.conversationId ?? f.phone}|${f.connectionId ?? ''}`} className="rounded-lg border border-slate-200 dark:border-white/10 px-3 py-2">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{nameOf(f)}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{f.conversationId ? 'Grupo' : f.phone}</p>
                  {f.error && <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">{f.error}</p>}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            {/* Busca */}
            <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-slate-200 dark:border-white/10">
              <Search size={15} className="text-slate-400 shrink-0" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Buscar por nome ou telefone..."
                className="flex-1 bg-transparent text-sm outline-none text-slate-900 dark:text-white"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  aria-label="Limpar busca"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Lista */}
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-custom p-1.5">
              {convsQ.isLoading ? (
                <p className="px-3 py-6 text-sm text-slate-400 text-center">Carregando conversas...</p>
              ) : filtered.length === 0 ? (
                <p className="px-3 py-6 text-sm text-slate-400 text-center">
                  {recipients.length === 0
                    ? 'Nenhuma conversa ou contato com telefone ainda.'
                    : 'Ninguém com esse nome ou telefone.'}
                </p>
              ) : (
                <>
                  {filtered.slice(0, MAX_LISTED).map(r => {
                    const checked = selected.has(r.key);
                    const via = senderLabel(r.connectionId);
                    return (
                      <button
                        key={r.key}
                        type="button"
                        onClick={() => toggle(r)}
                        aria-pressed={checked}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                          checked ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'hover:bg-slate-100 dark:hover:bg-white/10'
                        }`}
                      >
                        <span
                          className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 text-sm font-bold ${
                            r.hasConversation
                              ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                              : 'bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-300'
                          }`}
                        >
                          {r.isGroup ? (
                            <Users size={16} />
                          ) : r.hasConversation ? (
                            <MessageCircle size={16} />
                          ) : (
                            (r.name.trim().charAt(0) || '?').toUpperCase()
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{r.name}</span>
                          <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">
                            {r.isGroup
                              ? `Grupo${r.participantsCount ? ` · ${r.participantsCount} participantes` : ''}`
                              : r.phone}
                            {via ? ` · via ${via}` : ''}
                          </span>
                        </span>
                        <span
                          className={`h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                            checked
                              ? 'bg-emerald-600 border-emerald-600 text-white'
                              : 'border-slate-300 dark:border-white/20 text-transparent'
                          }`}
                          aria-hidden
                        >
                          <Check size={12} strokeWidth={3} />
                        </span>
                      </button>
                    );
                  })}
                  {filtered.length > MAX_LISTED && (
                    <p className="px-3 py-2 text-[11px] text-slate-400 text-center">
                      Mostrando {MAX_LISTED} de {filtered.length}. Refine a busca para achar os demais.
                    </p>
                  )}
                </>
              )}
            </div>
          </>
        )}

        {/* Rodapé */}
        <div className="shrink-0 border-t border-slate-200 dark:border-white/10 px-4 py-3">
          {error && <p className="mb-2 text-xs text-red-500">{error}</p>}
          {partial ? (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="h-9 px-4 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold"
              >
                Fechar
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <p className="flex-1 min-w-0 text-xs text-slate-500 dark:text-slate-400 truncate">
                {selected.size === 0
                  ? 'Escolha um ou mais contatos'
                  : selected.size === 1
                    ? Array.from(selected.values())[0].name
                    : `${selected.size} contatos selecionados`}
              </p>
              <button
                type="button"
                onClick={onClose}
                disabled={sending}
                className="h-9 px-3 inline-flex items-center rounded-xl border border-slate-200 dark:border-white/10 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={selected.size === 0 || sending}
                className="h-9 px-4 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold"
              >
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Forward size={16} />}
                Encaminhar{selected.size > 1 ? ` (${selected.size})` : ''}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
