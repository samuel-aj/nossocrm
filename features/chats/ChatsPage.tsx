'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, MessageCircle, Search, Users, X } from 'lucide-react';
import { useCRM } from '@/context/CRMContext';
import { DealWhatsAppChat } from '@/features/whatsapp/DealWhatsAppChat';
import { brPhoneVariants } from '@/lib/phone';
import { Contact } from '@/types';

// ---------------------------------------------------------------------------
// Página CHATS: inbox de WhatsApp da organização, estilo WhatsApp Web.
// Coluna esquerda: conversas (ordenadas pela mais recente) + todos os
// contatos do CRM com telefone (pra puxar assunto do zero). Coluna direita:
// o mesmo chat usado no card do lead (features/whatsapp/DealWhatsAppChat).
// ---------------------------------------------------------------------------

type ConvRow = {
  id: string;
  wa_phone: string;
  wa_name: string | null;
  contact_id: string | null;
  deal_id: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number | null;
};

type ChatTarget = { phone: string; name: string; contactId: string | null };

type ChatListItem = ChatTarget & {
  key: string;
  contact: Contact | null;
  lastAt: string | null;
  preview: string;
  unread: number;
};

// Paleta de gradientes p/ avatar de iniciais (hash do nome → cor estável)
const AVATAR_STYLES = [
  'from-emerald-400 to-teal-600',
  'from-sky-400 to-blue-600',
  'from-violet-400 to-purple-600',
  'from-amber-400 to-orange-600',
  'from-rose-400 to-pink-600',
  'from-indigo-400 to-blue-700',
  'from-lime-400 to-green-600',
  'from-cyan-400 to-sky-600',
];

function avatarStyle(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_STYLES[h % AVATAR_STYLES.length];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase() || '?';
}

// Carimbo de hora estilo WhatsApp: hoje HH:mm; ontem "Ontem"; senão dd/mm/aa
function fmtListTime(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// Chave canônica do telefone: junta as grafias com/sem o nono dígito BR
function phoneKey(phone: string) {
  const variants = brPhoneVariants(phone);
  if (variants.length === 0) return phone;
  return variants.slice().sort((a, b) => b.length - a.length)[0];
}

const norm = (s: string) => s.toLowerCase();

const AvatarCircle: React.FC<{ name: string; src?: string; size?: string }> = ({ name, src, size = 'w-12 h-12' }) => (
  src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className={`${size} rounded-full object-cover shrink-0`} />
  ) : (
    <span className={`${size} rounded-full bg-gradient-to-br ${avatarStyle(name)} text-white font-bold flex items-center justify-center shrink-0 text-sm`}>
      {initials(name)}
    </span>
  )
);

export const ChatsPage: React.FC = () => {
  const { contacts } = useCRM();
  const [selected, setSelected] = useState<ChatTarget | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [tab, setTab] = useState<'conversas' | 'contatos'>('conversas');

  const convsQ = useQuery<{ data: ConvRow[] }>({
    queryKey: ['waConversations'],
    queryFn: async () => {
      const res = await fetch('/api/whatsapp/conversations', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
    staleTime: 5000,
  });

  const connQ = useQuery<{ connected: boolean }>({
    queryKey: ['waConnection'],
    queryFn: async () => {
      const res = await fetch('/api/whatsapp/connection', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });
  const connected = !!connQ.data?.connected;

  const contactsById = useMemo(() => new Map(contacts.map(c => [c.id, c])), [contacts]);

  // Índice telefone→contato cobrindo as variantes BR (com/sem nono dígito)
  const contactByPhone = useMemo(() => {
    const m = new Map<string, Contact>();
    for (const c of contacts) {
      for (const v of brPhoneVariants(c.phone)) {
        if (!m.has(v)) m.set(v, c);
      }
    }
    return m;
  }, [contacts]);

  // Conversas com nome/contato resolvidos e grafias do mesmo número unificadas.
  // SÓ aparecem conversas de CONTATOS DO CRM — mensagens de números avulsos do
  // WhatsApp conectado ficam de fora (crie o contato pra conversa aparecer).
  const conversations = useMemo<ChatListItem[]>(() => {
    const rows = convsQ.data?.data ?? [];
    const byKey = new Map<string, ChatListItem>();
    for (const r of rows) {
      const key = phoneKey(r.wa_phone);
      const contact =
        (r.contact_id ? contactsById.get(r.contact_id) : undefined) ||
        contactByPhone.get(r.wa_phone) ||
        null;
      const item: ChatListItem = {
        key,
        phone: r.wa_phone,
        name: contact?.name || r.wa_name || r.wa_phone,
        contactId: contact?.id ?? r.contact_id,
        contact,
        lastAt: r.last_message_at,
        preview: r.last_message_preview || '',
        unread: r.unread_count || 0,
      };
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, item);
        continue;
      }
      // Duas grafias do mesmo número: fica a identidade com contato e o
      // conteúdo (preview/hora) da mais recente; não lidas somam.
      const newer = (item.lastAt || '') > (prev.lastAt || '') ? item : prev;
      const identity = item.contact ? item : prev.contact ? prev : newer;
      byKey.set(key, {
        ...identity,
        lastAt: newer.lastAt,
        preview: newer.preview || identity.preview,
        unread: prev.unread + item.unread,
      });
    }
    return Array.from(byKey.values())
      .filter(c => !!c.contact)
      .sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || ''));
  }, [convsQ.data, contactsById, contactByPhone]);

  const filteredConversations = useMemo(() => {
    const q = norm(searchQuery.trim());
    if (!q) return conversations;
    return conversations.filter(c =>
      norm(c.name).includes(q) || c.phone.includes(q) || norm(c.preview).includes(q)
    );
  }, [conversations, searchQuery]);

  // Todos os contatos do CRM com telefone (aba Contatos)
  const phoneContacts = useMemo(() => {
    const list = contacts.filter(c => (c.phone || '').trim() !== '');
    const q = norm(searchQuery.trim());
    const filtered = q
      ? list.filter(c => norm(c.name).includes(q) || c.phone.includes(q) || norm(c.email || '').includes(q))
      : list;
    return filtered.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [contacts, searchQuery]);

  const openChat = (target: ChatTarget) => setSelected(target);
  const selectedKey = selected ? phoneKey(selected.phone) : null;

  return (
    // Tela CHEIA: ancora no <main> (que é relative) e ignora o p-6 dele —
    // nada de cartão flutuante; o chat cola nas bordas da área de conteúdo.
    <div
      className="absolute inset-0 flex bg-white dark:bg-dark-card overflow-hidden"
      style={{ paddingBottom: 'calc(var(--app-bottom-nav-height, 0px) + var(--app-safe-area-bottom, 0px))' }}
    >
      {/* ============ COLUNA ESQUERDA: conversas + contatos ============ */}
      <aside className={`${selected ? 'hidden md:flex' : 'flex'} w-full md:w-[360px] lg:w-[380px] shrink-0 flex-col border-r border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card`}>
        {/* Cabeçalho */}
        <div className="shrink-0 px-4 pt-4 pb-3 border-b border-slate-100 dark:border-white/5">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h1 className="text-lg font-display font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <MessageCircle size={17} />
              </span>
              Chats
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-full ${
                connected
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                  : 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'
              }`}
              title={connected ? 'WhatsApp conectado' : 'WhatsApp desconectado — conecte em Configurações → Integrações'}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              {connected ? 'Conectado' : 'Desconectado'}
            </span>
          </div>

          {/* Busca */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-10" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={tab === 'conversas' ? 'Pesquisar conversa...' : 'Pesquisar contato...'}
              className="w-full bg-slate-100 dark:bg-black/20 border border-transparent focus:border-emerald-400 rounded-lg pl-9 pr-8 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5"
                aria-label="Limpar busca"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Abas Conversas / Contatos */}
          <div className="flex gap-1 mt-3">
            {([
              { id: 'conversas' as const, label: 'Conversas', icon: MessageCircle },
              { id: 'contatos' as const, label: 'Contatos', icon: Users },
            ]).map(t => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    active
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10'
                  }`}
                >
                  <t.icon size={13} /> {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-custom">
          {tab === 'conversas' ? (
            <>
              {convsQ.isLoading && (
                <p className="text-sm text-slate-400 text-center py-8">Carregando conversas...</p>
              )}
              {!convsQ.isLoading && filteredConversations.length === 0 && (
                <div className="text-center py-10 px-6 text-slate-400">
                  <MessageCircle size={28} className="mx-auto mb-2 opacity-40" />
                  <p className="text-sm">
                    {searchQuery ? 'Nenhuma conversa encontrada.' : 'Nenhuma conversa com contatos do CRM ainda. Puxe assunto pela aba Contatos 👉'}
                  </p>
                </div>
              )}
              {filteredConversations.map(c => {
                const active = selectedKey === c.key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => openChat({ phone: c.phone, name: c.name, contactId: c.contactId })}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-slate-50 dark:border-white/5 transition-colors ${
                      active ? 'bg-emerald-50 dark:bg-emerald-900/15' : 'hover:bg-slate-50 dark:hover:bg-white/5'
                    }`}
                  >
                    <AvatarCircle name={c.name} src={c.contact?.avatar || undefined} />
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">{c.name}</span>
                        <span className={`text-[10px] shrink-0 ${c.unread > 0 ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-slate-400'}`}>
                          {fmtListTime(c.lastAt)}
                        </span>
                      </span>
                      <span className="flex items-center justify-between gap-2 mt-0.5">
                        <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          {c.preview || 'Sem mensagens'}
                        </span>
                        {c.unread > 0 && (
                          <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center">
                            {c.unread > 99 ? '99+' : c.unread}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
            </>
          ) : (
            <>
              {phoneContacts.length === 0 && (
                <div className="text-center py-10 px-6 text-slate-400">
                  <Users size={28} className="mx-auto mb-2 opacity-40" />
                  <p className="text-sm">
                    {searchQuery ? 'Nenhum contato encontrado.' : 'Nenhum contato com telefone no CRM.'}
                  </p>
                </div>
              )}
              {phoneContacts.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => openChat({ phone: c.phone, name: c.name, contactId: c.id })}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left border-b border-slate-50 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                >
                  <AvatarCircle name={c.name} src={c.avatar || undefined} size="w-10 h-10" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-slate-900 dark:text-white truncate">{c.name}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">{c.phone}</span>
                  </span>
                  <MessageCircle size={15} className="shrink-0 text-emerald-500/70" />
                </button>
              ))}
            </>
          )}
        </div>
      </aside>

      {/* ============ COLUNA DIREITA: chat ============ */}
      <section className={`${selected ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 flex-col bg-slate-50/40 dark:bg-black/10`}>
        {selected ? (
          <>
            {/* Voltar (só mobile — no desktop a lista fica sempre visível) */}
            <div className="md:hidden shrink-0 px-2 py-1.5 border-b border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card">
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10"
              >
                <ArrowLeft size={16} /> Conversas
              </button>
            </div>
            <div className="flex-1 min-h-0">
              {/* key={phone} garante reset total do composer/busca ao trocar de conversa */}
              <DealWhatsAppChat
                key={selected.phone}
                contact={{ id: selected.contactId || selected.phone, name: selected.name, phone: selected.phone }}
              />
            </div>
          </>
        ) : (
          // Estado vazio estilo WhatsApp Web
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 px-8">
            <span className="w-20 h-20 rounded-full bg-emerald-100/70 dark:bg-emerald-900/25 text-emerald-500 flex items-center justify-center">
              <MessageCircle size={38} />
            </span>
            <h2 className="text-lg font-display font-bold text-slate-700 dark:text-slate-200">Suas conversas de WhatsApp</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm">
              Selecione uma conversa ao lado ou escolha um contato pra começar. Tudo que chegar no
              WhatsApp da organização aparece aqui e no card do lead.
            </p>
            {!connected && (
              <Link
                href="/settings/integracoes#whatsapp"
                className="mt-1 text-xs font-bold text-amber-600 dark:text-amber-400 hover:underline"
              >
                WhatsApp desconectado — conectar em Configurações → Integrações
              </Link>
            )}
          </div>
        )}
      </section>
    </div>
  );
};

export default ChatsPage;
