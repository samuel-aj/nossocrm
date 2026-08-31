'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCheck, ChevronDown, ExternalLink, KanbanSquare, MessageCircle, MessageSquareDot, Plus, Search, UserPlus, Users, X } from 'lucide-react';
import { useCRM } from '@/context/CRMContext';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { DealWhatsAppChat } from '@/features/whatsapp/DealWhatsAppChat';
import { brPhoneVariants, normalizePhoneE164 } from '@/lib/phone';
import { Contact, Deal } from '@/types';

// ---------------------------------------------------------------------------
// Página CHATS: inbox de WhatsApp da organização, estilo WhatsApp Web.
// Coluna esquerda: LISTA ÚNICA com todos os contatos do CRM que têm telefone —
// quem tem conversa mostra prévia/hora/não-lidas e sobe pro topo (mais
// recente primeiro); quem não tem aparece em ordem alfabética pra puxar
// assunto. Coluna direita: o mesmo chat do card do lead (DealWhatsAppChat).
// ---------------------------------------------------------------------------

type ConvRow = {
  id: string;
  connection_id: string | null;
  wa_phone: string;
  wa_name: string | null;
  contact_id: string | null;
  deal_id: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number | null;
  /** GRUPO do WhatsApp (só vem quando a org ligou grupos): wa_phone = JID do grupo */
  is_group?: boolean | null;
  group_jid?: string | null;
  participants_count?: number | null;
};

type ConvInfo = {
  connectionId: string | null;
  phone: string;
  contactId: string | null;
  waName: string;
  lastAt: string | null;
  preview: string;
  unread: number;
};

type ChatTarget = {
  phone: string;
  name: string;
  contactId: string | null;
  /** Conversa presa a um número conectado (null = visão unificada) */
  connectionId?: string | null;
  /** GRUPO: abre pelo id da conversa (sem contato nem telefone) */
  conversationId?: string | null;
  isGroup?: boolean;
  participantsCount?: number | null;
};

/** Filtro da lista, estilo WhatsApp: tudo | só não lidas | só quem tem conversa | só grupos */
type ChatFilter = 'all' | 'unread' | 'convs' | 'groups';

type ChatListItem = ChatTarget & {
  key: string;
  /** Número conectado desta conversa (null = contato ainda sem conversa) */
  connectionId: string | null;
  /** null = número sem contato no CRM (conversa nova chegando no WhatsApp) */
  contact: Contact | null;
  hasConv: boolean;
  lastAt: string | null;
  preview: string;
  unread: number;
  /** GRUPO do WhatsApp */
  isGroup?: boolean;
  conversationId?: string | null;
  participantsCount?: number | null;
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
  const { contacts, deals, boards, addContact, addDeal } = useCRM();
  const { profile } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<ChatTarget | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<ChatFilter>('all');
  // Menu da setinha (⌄) em cada conversa — estilo WhatsApp. Guarda a POSIÇÃO
  // da seta: o balão é `fixed` com a borda esquerda alinhada nela (pode
  // avançar por cima da área do chat, sem ser cortado pela lista).
  const [rowMenu, setRowMenu] = useState<{ key: string; x: number; y: number } | null>(null);

  // Fecha o menu da conversa ao clicar fora, rolar a lista ou apertar Esc
  useEffect(() => {
    if (!rowMenu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as Element | null)?.closest?.('[data-chat-row-menu]')) setRowMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRowMenu(null);
    };
    const onScroll = () => setRowMenu(null);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [rowMenu]);

  // Modal "Novo contato" (adiciona no CRM e já abre o chat dele)
  const [newContactOpen, setNewContactOpen] = useState(false);
  const [ncName, setNcName] = useState('');
  const [ncPhone, setNcPhone] = useState('');
  const [ncEmail, setNcEmail] = useState('');
  const [ncBusy, setNcBusy] = useState(false);

  // Modal "Criar lead" (escolhe a pipeline e a etapa)
  const [leadModalOpen, setLeadModalOpen] = useState(false);
  const [leadBoardId, setLeadBoardId] = useState('');
  const [leadStageId, setLeadStageId] = useState('');
  const [leadBusy, setLeadBusy] = useState(false);

  // Modal "Novo grupo" (Groups API da Meta: grupo criado pela empresa, entrada por convite)
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [ngSubject, setNgSubject] = useState('');
  const [ngDesc, setNgDesc] = useState('');
  const [ngConn, setNgConn] = useState('');
  const [ngBusy, setNgBusy] = useState(false);

  // Número conectado escolhido pra ver os chats ('all' = todos). Persiste por
  // ABA (sessionStorage), casando com o modelo de org por aba: aba em outra
  // org não herda o filtro desta, e o reset abaixo não apaga escolha alheia.
  const [connFilter, setConnFilter] = useState<string>(() => {
    if (typeof window === 'undefined') return 'all';
    return window.sessionStorage.getItem('wa-chats-connection') || 'all';
  });
  const [connMenuOpen, setConnMenuOpen] = useState(false);

  type ConnRow = {
    id: string;
    provider: string;
    phoneNumber: string | null;
    profileName: string | null;
    status: string;
  };
  const connQ = useQuery<{ connected: boolean; connections?: ConnRow[] }>({
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
  const connsList = connQ.data?.connections ?? [];

  // Filtro EFETIVO: só vale depois que as conexões chegam, se a escolhida
  // existe E a org tem 2+ números (com 1 número o menu nem aparece; um filtro
  // ativo ali seria invisível e esconderia conversas antigas sem connection_id).
  // Antes disso, 'all' — a lista nunca abre vazia por filtro fantasma.
  const effectiveConn =
    connsList.length > 1 && connsList.some(c => c.id === connFilter) ? connFilter : 'all';

  const convsQ = useQuery<{ data: ConvRow[]; groupsEnabled?: boolean }>({
    // Com 'all' a queryKey volta a ser a MESMA do badge do menu lateral
    // (Layout.tsx): um cache só, sem busca duplicada nem contagem defasada.
    queryKey: effectiveConn === 'all' ? ['waConversations'] : ['waConversations', effectiveConn],
    queryFn: async () => {
      const url =
        effectiveConn === 'all'
          ? '/api/whatsapp/conversations'
          : `/api/whatsapp/conversations?connectionId=${encodeURIComponent(effectiveConn)}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
    staleTime: 5000,
  });

  // Conexão salva não vale mais nesta org (trocou de org na aba, número
  // removido, org voltou a ter 1 número): limpa o estado e o storage da aba.
  useEffect(() => {
    if (connFilter === 'all' || !connQ.data) return;
    if (connsList.length < 2 || !connsList.some(c => c.id === connFilter)) {
      setConnFilter('all');
      if (typeof window !== 'undefined') window.sessionStorage.removeItem('wa-chats-connection');
    }
  }, [connQ.data, connsList, connFilter]);

  const pickConn = (id: string) => {
    setConnFilter(id);
    setConnMenuOpen(false);
    if (typeof window !== 'undefined') {
      if (id === 'all') window.sessionStorage.removeItem('wa-chats-connection');
      else window.sessionStorage.setItem('wa-chats-connection', id);
    }
  };

  // Fecha o menu de números ao clicar fora ou apertar Esc
  useEffect(() => {
    if (!connMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as Element | null)?.closest?.('[data-conn-menu]')) setConnMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConnMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [connMenuOpen]);

  // Conversas indexadas por (número conectado + telefone canônico): cada
  // número é um "WhatsApp" próprio — o mesmo cliente em dois números vira DUAS
  // linhas. Só as grafias com/sem nono dígito do MESMO número se fundem.
  const convByKey = useMemo(() => {
    const m = new Map<string, ConvInfo>();
    for (const r of convsQ.data?.data ?? []) {
      if (r.is_group) continue; // grupos têm linhas próprias (groupItems)
      const key = `${r.connection_id ?? 'none'}#${phoneKey(r.wa_phone)}`;
      const item: ConvInfo = {
        connectionId: r.connection_id ?? null,
        phone: r.wa_phone,
        contactId: r.contact_id,
        waName: (r.wa_name || '').trim(),
        lastAt: r.last_message_at,
        preview: r.last_message_preview || '',
        unread: r.unread_count || 0,
      };
      const prev = m.get(key);
      if (!prev) {
        m.set(key, item);
        continue;
      }
      const newer = (item.lastAt || '') > (prev.lastAt || '') ? item : prev;
      m.set(key, {
        ...newer,
        contactId: newer.contactId ?? prev.contactId ?? item.contactId,
        waName: newer.waName || prev.waName || item.waName,
        unread: prev.unread + item.unread,
      });
    }
    return m;
  }, [convsQ.data]);

  // As mesmas conversas agrupadas por telefone (contato do CRM não tem número
  // conectado; o casamento contato<->conversas é por telefone).
  const convsByPhone = useMemo(() => {
    const m = new Map<string, ConvInfo[]>();
    for (const c of convByKey.values()) {
      const key = phoneKey(c.phone);
      const list = m.get(key) ?? [];
      list.push(c);
      m.set(key, list);
    }
    for (const list of m.values()) list.sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || ''));
    return m;
  }, [convByKey]);

  // GRUPOS do WhatsApp (só chegam com a chave da org ligada): linha própria,
  // aberta pelo id da conversa; sem contato/lead.
  const groupsEnabled = !!convsQ.data?.groupsEnabled;
  const groupItems = useMemo<ChatListItem[]>(() => {
    const out: ChatListItem[] = [];
    for (const r of convsQ.data?.data ?? []) {
      if (!r.is_group) continue;
      out.push({
        key: `group#${r.id}`,
        connectionId: r.connection_id ?? null,
        phone: r.group_jid || r.wa_phone,
        name: (r.wa_name || '').trim() || 'Grupo',
        contactId: null,
        contact: null,
        hasConv: true,
        lastAt: r.last_message_at,
        preview: r.last_message_preview || '',
        unread: r.unread_count || 0,
        isGroup: true,
        conversationId: r.id,
        participantsCount: r.participants_count ?? null,
      });
    }
    return out;
  }, [convsQ.data]);

  // Quantas CONVERSAS têm mensagem não lida (número no chip "Não lidas",
  // igual ao WhatsApp: conta conversas, não mensagens)
  const unreadChats = useMemo(
    () =>
      Array.from(convByKey.values()).filter(c => c.unread > 0).length +
      groupItems.filter(g => g.unread > 0).length,
    [convByKey, groupItems]
  );

  // LISTA ÚNICA: contatos do CRM com telefone + conversas NOVAS de números
  // sem contato (chegando no WhatsApp desde a conexão — histórico antigo do
  // celular nunca é importado). Quem tem conversa fica no topo por recência;
  // contatos sem conversa seguem em ordem alfabética.
  const chatList = useMemo<ChatListItem[]>(() => {
    // DEDUP por telefone: contatos duplicados (mesmo número) viram UMA linha
    // só — fica o contato VINCULADO à conversa; sem vínculo, o mais antigo.
    const contactByKey = new Map<string, Contact>();
    for (const c of contacts) {
      if ((c.phone || '').trim() === '') continue;
      const key = phoneKey(c.phone);
      const prev = contactByKey.get(key);
      if (!prev) {
        contactByKey.set(key, c);
        continue;
      }
      const linkedId = (convsByPhone.get(key) ?? []).find(cv => cv.contactId)?.contactId;
      if (linkedId === c.id && linkedId !== prev.id) {
        contactByKey.set(key, c);
        continue;
      }
      if (linkedId === prev.id) continue;
      if ((c.createdAt || '') < (prev.createdAt || '')) contactByKey.set(key, c);
    }

    const items: ChatListItem[] = [];
    for (const [key, c] of contactByKey.entries()) {
      const convs = convsByPhone.get(key) ?? [];
      if (convs.length === 0) {
        items.push({
          key,
          connectionId: null,
          phone: c.phone,
          name: c.name,
          contactId: c.id,
          contact: c,
          hasConv: false,
          lastAt: null,
          preview: '',
          unread: 0,
        });
        continue;
      }
      for (const conv of convs) {
        items.push({
          key: `${conv.connectionId ?? 'none'}#${key}`,
          connectionId: conv.connectionId,
          phone: conv.phone,
          name: c.name,
          contactId: c.id,
          contact: c,
          hasConv: true,
          lastAt: conv.lastAt,
          preview: conv.preview,
          unread: conv.unread,
        });
      }
    }

    // Conversas de números SEM contato no CRM: aparecem também (nome do
    // WhatsApp ou o número) — dá pra responder e criar contato/lead dali.
    for (const [key, convs] of convsByPhone.entries()) {
      if (contactByKey.has(key)) continue;
      for (const conv of convs) {
        items.push({
          key: `${conv.connectionId ?? 'none'}#${key}`,
          connectionId: conv.connectionId,
          phone: conv.phone,
          name: conv.waName || conv.phone,
          contactId: null,
          contact: null,
          hasConv: true,
          lastAt: conv.lastAt,
          preview: conv.preview,
          unread: conv.unread,
        });
      }
    }

    // grupos entram na mesma lista (em cima, por recência, junto das conversas)
    items.push(...groupItems);

    const q = norm(searchQuery.trim());
    const filtered = q
      ? items.filter(c =>
          norm(c.name).includes(q) || c.phone.includes(q) || norm(c.preview).includes(q) || norm(c.contact?.email || '').includes(q)
        )
      : items;

    const byTab =
      filter === 'unread'
        ? filtered.filter(c => c.unread > 0)
        : filter === 'convs'
          ? filtered.filter(c => c.hasConv)
          : filter === 'groups'
            ? filtered.filter(c => c.isGroup)
            : filtered;

    return byTab.sort((a, b) => {
      if (a.hasConv && b.hasConv) return (b.lastAt || '').localeCompare(a.lastAt || '');
      if (a.hasConv !== b.hasConv) return a.hasConv ? -1 : 1;
      return a.name.localeCompare(b.name, 'pt-BR');
    });
  }, [contacts, convsByPhone, groupItems, searchQuery, filter]);

  const openChat = (target: ChatTarget) => setSelected(target);
  const selectedKey = selected
    ? selected.isGroup
      ? `group#${selected.conversationId}`
      : `${selected.connectionId ?? 'none'}#${phoneKey(selected.phone)}`
    : null;

  // Lead do contato selecionado: prefere um deal ABERTO (nem ganho nem
  // perdido); entre vários, o mais recente. null = "Criar lead" disponível.
  const selectedDeal = useMemo(() => {
    if (!selected?.contactId) return null;
    const list = deals.filter(d => d.contactId === selected.contactId);
    if (list.length === 0) return null;
    const open = list.filter(d => !d.isWon && !d.isLost);
    const pool = open.length ? open : list;
    return pool.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
  }, [deals, selected?.contactId]);

  const selectedDealBoard = useMemo(
    () => (selectedDeal ? boards.find(b => b.id === selectedDeal.boardId) ?? null : null),
    [boards, selectedDeal]
  );
  const selectedDealStage = selectedDealBoard?.stages.find(s => s.id === selectedDeal?.status) ?? null;

  // "Marcar como lida": zera a bolinha sem abrir a conversa (reusa o GET de
  // mensagens, que já faz o reset do contador ao visualizar).
  const handleMarkRead = async (phone: string, connectionId: string | null, conversationId?: string | null) => {
    try {
      const url = conversationId
        ? `/api/whatsapp/messages?conversationId=${encodeURIComponent(conversationId)}`
        : `/api/whatsapp/messages?phone=${encodeURIComponent(phone)}` +
          (connectionId ? `&connectionId=${encodeURIComponent(connectionId)}` : '');
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await queryClient.invalidateQueries({ queryKey: ['waConversations'] });
      addToast('Conversa marcada como lida.', 'success');
    } catch {
      addToast('Não foi possível marcar como lida.', 'error');
    }
  };

  // "Marcar como não lida" (igual WhatsApp): arma a bolinha na lista. Se a
  // conversa estiver ABERTA, fecha — senão o próprio polling de leitura
  // zeraria o marcador em seguida. 100% interno: nada vai pro WhatsApp.
  const handleMarkUnread = async (phone: string, connectionId: string | null, conversationId?: string | null) => {
    try {
      const res = await fetch('/api/whatsapp/conversations/unread', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(conversationId ? { conversationId } : { phone, connectionId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const isSelected = conversationId
        ? selected?.conversationId === conversationId
        : !!selected &&
          !selected.isGroup &&
          phoneKey(selected.phone) === phoneKey(phone) &&
          (selected.connectionId ?? null) === connectionId;
      if (isSelected) setSelected(null);
      await queryClient.invalidateQueries({ queryKey: ['waConversations'] });
      addToast('Conversa marcada como não lida.', 'success');
    } catch {
      addToast('Não foi possível marcar como não lida.', 'error');
    }
  };

  const openNewContactModal = (prefill?: { name?: string; phone?: string }) => {
    setNcName(prefill?.name ?? '');
    setNcPhone(prefill?.phone ?? '');
    setNcEmail('');
    setNewContactOpen(true);
  };

  const handleCreateContact = async () => {
    const name = ncName.trim();
    const phone = normalizePhoneE164(ncPhone.trim());
    if (!name || !phone) {
      addToast('Nome e telefone são obrigatórios.', 'warning');
      return;
    }
    const dup = contacts.find(c => (c.phone || '').trim() && phoneKey(c.phone) === phoneKey(phone));
    if (dup) {
      addToast(`Já existe um contato com esse telefone: ${dup.name}.`, 'warning');
      return;
    }
    setNcBusy(true);
    try {
      const created = await addContact({
        name,
        email: ncEmail.trim(),
        phone,
        status: 'ACTIVE',
        stage: 'LEAD',
        lastPurchaseDate: '',
        totalValue: 0,
      } as Omit<Contact, 'id' | 'createdAt'>);
      if (created) {
        addToast(`Contato "${name}" criado!`, 'success');
        setNewContactOpen(false);
        setNcName('');
        setNcPhone('');
        setNcEmail('');
        setSelected({ phone: created.phone || phone, name: created.name, contactId: created.id });
        // O trigger do banco vincula a conversa órfã ao contato novo — recarrega
        // a lista pra linha "sem contato" virar o contato na hora.
        void queryClient.invalidateQueries({ queryKey: ['waConversations'] });
      } else {
        addToast('Falha ao criar o contato. Tente novamente.', 'error');
      }
    } finally {
      setNcBusy(false);
    }
  };

  // Números da API oficial conectados: só eles criam grupo pelo CRM
  const metaConns = connsList.filter(c => c.provider === 'meta_cloud' && c.status === 'connected');
  const canCreateGroup = groupsEnabled && metaConns.length > 0;

  const openNewGroupModal = () => {
    setNgSubject('');
    setNgDesc('');
    setNgConn(metaConns[0]?.id ?? '');
    setNewGroupOpen(true);
  };

  const handleCreateGroup = async () => {
    const subject = ngSubject.trim();
    const connectionId = ngConn || metaConns[0]?.id || '';
    if (!subject || !connectionId || ngBusy) return;
    setNgBusy(true);
    try {
      const res = await fetch('/api/whatsapp/groups/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ connectionId, subject, description: ngDesc.trim() || undefined }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        conversationId?: string;
        inviteLink?: string | null;
        error?: string;
      };
      if (!res.ok || !j.conversationId) throw new Error(j.error || `HTTP ${res.status}`);
      if (j.inviteLink) {
        try {
          await navigator.clipboard.writeText(j.inviteLink);
          addToast('Grupo criado. Link de convite copiado: mande para quem deve entrar.', 'success');
        } catch {
          addToast('Grupo criado. Use o botão Convite no chat para copiar o link.', 'success');
        }
      } else {
        addToast('Grupo criado. O link de convite pode ser gerado pelo botão Convite no chat.', 'success');
      }
      setNewGroupOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['waConversations'] });
      setSelected({
        phone: '',
        name: subject,
        contactId: null,
        connectionId,
        conversationId: j.conversationId,
        isGroup: true,
        participantsCount: 1,
      });
    } catch (e) {
      addToast((e as Error).message || 'Não deu para criar o grupo.', 'error');
    } finally {
      setNgBusy(false);
    }
  };

  const openLeadModal = () => {
    const firstBoard = boards[0];
    setLeadBoardId(firstBoard?.id || '');
    setLeadStageId(firstBoard?.stages[0]?.id || '');
    setLeadModalOpen(true);
  };

  const handleCreateLead = async () => {
    if (!selected?.contactId || !leadBoardId || !leadStageId || leadBusy) return;
    const contact = contacts.find(c => c.id === selected.contactId);
    setLeadBusy(true);
    try {
      const created = await addDeal({
        title: selected.name,
        contactId: selected.contactId,
        companyId: contact?.clientCompanyId || contact?.companyId,
        boardId: leadBoardId,
        value: 0,
        items: [],
        status: leadStageId,
        updatedAt: new Date().toISOString(),
        probability: 10,
        priority: 'medium',
        tags: [],
        owner: { name: 'Eu', avatar: 'https://i.pravatar.cc/150?u=me' },
        customFields: {},
        isWon: false,
        isLost: false,
      } as Omit<Deal, 'id' | 'createdAt'>);
      if (created) {
        const b = boards.find(x => x.id === leadBoardId);
        addToast(`Lead criado em "${b?.name ?? 'board'}"!`, 'success');
        setLeadModalOpen(false);
      } else {
        addToast('Falha ao criar o lead. Tente novamente.', 'error');
      }
    } finally {
      setLeadBusy(false);
    }
  };

  return (
    // Tela CHEIA: ancora no <main> (que é relative) e ignora o p-6 dele —
    // nada de cartão flutuante; o chat cola nas bordas da área de conteúdo.
    <div
      className="absolute inset-0 flex bg-white dark:bg-dark-card overflow-hidden"
      style={{ paddingBottom: 'calc(var(--app-bottom-nav-height, 0px) + var(--app-safe-area-bottom, 0px))' }}
    >
      {/* ============ COLUNA ESQUERDA: conversas + contatos ============ */}
      {/* +50px de largura (era 360/380): nome de grupo costuma ter prefixo
          ("AJ Marketing - ...") e cortava antes de chegar na parte que
          identifica o grupo. */}
      <aside className={`${selected ? 'hidden md:flex' : 'flex'} w-full md:w-[410px] lg:w-[430px] shrink-0 flex-col border-r border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card`}>
        {/* Cabeçalho */}
        <div className="shrink-0 px-4 pt-4 pb-3 border-b border-slate-100 dark:border-white/5">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h1 className="text-lg font-display font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <MessageCircle size={17} />
              </span>
              Chats
            </h1>
            <span className="flex items-center gap-1.5">
              {connsList.length > 1 ? (
                /* Mais de um número conectado: o selo vira um menu que filtra
                   a lista de conversas pelo número escolhido. */
                <span className="relative" data-conn-menu>
                  <button
                    type="button"
                    onClick={() => setConnMenuOpen(o => !o)}
                    aria-expanded={connMenuOpen}
                    title="Escolher de qual número ver os chats"
                    className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-full transition-colors ${
                      connected
                        ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40'
                        : 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    {connFilter === 'all'
                      ? 'Todos os números'
                      : connsList.find(c => c.id === connFilter)?.phoneNumber ||
                        connsList.find(c => c.id === connFilter)?.profileName ||
                        'Número'}
                    <ChevronDown size={12} className={`transition-transform ${connMenuOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {connMenuOpen && (
                    <div className="absolute right-0 top-full mt-1.5 z-40 min-w-[230px] rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card shadow-xl p-1.5">
                      <button
                        type="button"
                        onClick={() => pickConn('all')}
                        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-xs font-semibold transition-colors ${
                          connFilter === 'all'
                            ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                            : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
                        }`}
                      >
                        Todos os números
                      </button>
                      {connsList.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => pickConn(c.id)}
                          className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-xs transition-colors ${
                            connFilter === c.id
                              ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                              : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 shrink-0 rounded-full ${
                              c.status === 'connected' ? 'bg-emerald-500' : 'bg-amber-500'
                            }`}
                          />
                          <span className="min-w-0">
                            <span className="block font-semibold truncate">{c.phoneNumber || 'Sem número'}</span>
                            {c.profileName && (
                              <span className="block text-[10px] text-slate-400 truncate">{c.profileName}</span>
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </span>
              ) : (
                <span
                  className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-full ${
                    connected
                      ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                      : 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'
                  }`}
                  title={connected ? 'WhatsApp conectado' : 'WhatsApp desconectado. Conecte na aba Conexão, no menu WhatsApp'}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  {connected ? 'Conectado' : 'Desconectado'}
                </span>
              )}
              {canCreateGroup && (
                <button
                  type="button"
                  onClick={openNewGroupModal}
                  title="Novo grupo (WhatsApp API oficial)"
                  aria-label="Novo grupo"
                  className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:text-violet-600 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
                >
                  <Users size={17} />
                </button>
              )}
              <button
                type="button"
                onClick={() => openNewContactModal()}
                title="Adicionar contato"
                aria-label="Adicionar contato"
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
              >
                <UserPlus size={17} />
              </button>
            </span>
          </div>

          {/* Busca */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-10" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Pesquisar contato ou conversa..."
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

          {/* Filtros da lista, chips estilo WhatsApp: Tudo / Não lidas N / Conversas */}
          <div className="flex items-center gap-1.5 mt-2.5 overflow-x-auto">
            {(
              [
                { id: 'all', label: 'Tudo', title: 'Todas as conversas e contatos' },
                { id: 'unread', label: 'Não lidas', title: 'Só conversas com mensagem não lida' },
                { id: 'convs', label: 'Conversas', title: 'Só quem já trocou mensagem' },
                // chip "Grupos" só quando a org ligou grupos na tela Conexão
                ...(groupsEnabled ? [{ id: 'groups', label: 'Grupos', title: 'Só grupos do WhatsApp' }] : []),
              ] as Array<{ id: ChatFilter; label: string; title: string }>
            ).map(f => {
              const active = filter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  aria-pressed={active}
                  title={f.title}
                  className={`shrink-0 inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold border transition-colors ${
                    active
                      ? 'bg-emerald-100 dark:bg-emerald-900/40 border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                      : 'bg-slate-100 dark:bg-white/5 border-transparent text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10'
                  }`}
                >
                  {f.label}
                  {f.id === 'unread' && unreadChats > 0 && <span>{unreadChats > 99 ? '99+' : unreadChats}</span>}
                </button>
              );
            })}
          </div>

        </div>

        {/* Lista única: contatos do CRM — com conversa em cima, resto A→Z */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-custom">
          {chatList.length === 0 && (
            <div className="text-center py-10 px-6 text-slate-400">
              <Users size={28} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm">
                {searchQuery
                  ? 'Nenhum contato encontrado.'
                  : filter === 'unread'
                    ? 'Nenhuma conversa não lida. Tudo em dia!'
                    : filter === 'convs'
                      ? 'Nenhuma conversa ainda.'
                      : filter === 'groups'
                        ? 'Nenhum grupo ainda. Um grupo aparece aqui quando chega mensagem nele depois de ligar os grupos.'
                        : 'Nenhum contato com telefone no CRM.'}
              </p>
            </div>
          )}
          {chatList.map(c => {
            // mesma herança do openChat: linha sem conversa sob filtro de
            // número acende quando o chat pinado nesse número está aberto
            const rowConnId = c.connectionId ?? (effectiveConn !== 'all' ? effectiveConn : null);
            const active = c.isGroup ? selectedKey === c.key : selectedKey === `${rowConnId ?? 'none'}#${phoneKey(c.phone)}`;
            return (
              // wrapper relative: o botão "marcar como não lida" é IRMÃO da
              // linha (botão dentro de botão é HTML inválido), aparece no hover
              <div key={c.key} className="relative group/row">
              <button
                type="button"
                onClick={() =>
                  openChat(
                    c.isGroup
                      ? {
                          phone: c.phone,
                          name: c.name,
                          contactId: null,
                          connectionId: c.connectionId,
                          conversationId: c.conversationId,
                          isGroup: true,
                          participantsCount: c.participantsCount ?? null,
                        }
                      : {
                          phone: c.phone,
                          name: c.name,
                          contactId: c.contactId,
                          connectionId: c.connectionId ?? (effectiveConn !== 'all' ? effectiveConn : null),
                        }
                  )
                }
                className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-slate-50 dark:border-white/5 transition-colors ${
                  active ? 'bg-emerald-50 dark:bg-emerald-900/15' : 'hover:bg-slate-50 dark:hover:bg-white/5'
                }`}
              >
                {c.isGroup ? (
                  <span className="w-12 h-12 rounded-full bg-slate-200 dark:bg-white/10 text-slate-500 dark:text-slate-300 flex items-center justify-center shrink-0">
                    <Users size={20} />
                  </span>
                ) : (
                  <AvatarCircle name={c.name} src={c.contact?.avatar || undefined} />
                )}
                <span className="flex-1 min-w-0">
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">{c.name}</span>
                      {c.isGroup && (
                        <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-300">
                          grupo
                        </span>
                      )}
                      {!c.contact && !c.isGroup && (
                        <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
                          sem contato
                        </span>
                      )}
                      {connsList.length > 1 && effectiveConn === 'all' && c.connectionId && (
                        <span
                          className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400"
                          title={`Conversa do número ${connsList.find(x => x.id === c.connectionId)?.phoneNumber || ''}`}
                        >
                          {(connsList.find(x => x.id === c.connectionId)?.phoneNumber || 'número').replace('+55', '')}
                        </span>
                      )}
                    </span>
                    {c.hasConv && (
                      <span className={`text-[10px] shrink-0 ${c.unread > 0 ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-slate-400'}`}>
                        {fmtListTime(c.lastAt)}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {c.hasConv ? (c.preview || 'Sem mensagens') : c.phone}
                    </span>
                    <span className="shrink-0 flex items-center gap-1.5">
                      {c.unread > 0 && (
                        <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center">
                          {c.unread > 99 ? '99+' : c.unread}
                        </span>
                      )}
                      {/* Setinha DISCRETA (estilo WhatsApp): inline abaixo do
                          horário, sem fundo — só aparece no hover da linha */}
                      {c.hasConv && (
                        <span
                          role="button"
                          tabIndex={0}
                          data-chat-row-menu
                          title="Opções da conversa"
                          aria-label="Opções da conversa"
                          aria-expanded={rowMenu?.key === c.key}
                          onClick={e => {
                            e.stopPropagation();
                            const r = e.currentTarget.getBoundingClientRect();
                            // Clamp: no celular a seta encosta na borda direita
                            // e o balão de 240px estourava pra fora da tela.
                            const x = Math.max(8, Math.min(r.left, window.innerWidth - 248));
                            setRowMenu(m => (m?.key === c.key ? null : { key: c.key, x, y: r.bottom }));
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              const r = e.currentTarget.getBoundingClientRect();
                              const x = Math.max(8, Math.min(r.left, window.innerWidth - 248));
                              setRowMenu(m => (m?.key === c.key ? null : { key: c.key, x, y: r.bottom }));
                            }
                          }}
                          className={`text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors ${
                            rowMenu?.key === c.key ? 'inline-flex' : 'hidden group-hover/row:inline-flex max-md:inline-flex'
                          }`}
                        >
                          <ChevronDown size={16} />
                        </span>
                      )}
                    </span>
                  </span>
                </span>
              </button>
              {/* Balão do menu da conversa (estilo WhatsApp): `fixed` com a
                  borda ESQUERDA alinhada na seta — avança por cima da área do
                  chat sem ser cortado pela lista; sem sombra */}
              {c.hasConv && rowMenu?.key === c.key && (
                <div
                  data-chat-row-menu
                  className="fixed z-50 w-60 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 py-1.5"
                  style={{ left: rowMenu.x, top: rowMenu.y + 4 }}
                >
                  {c.unread > 0 ? (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        setRowMenu(null);
                        void handleMarkRead(c.phone, c.connectionId ?? (c.hasConv ? 'none' : null), c.conversationId);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                    >
                      <CheckCheck size={16} className="text-slate-400 dark:text-slate-500 shrink-0" />
                      Marcar como lida
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        setRowMenu(null);
                        void handleMarkUnread(c.phone, c.connectionId ?? (c.hasConv ? 'none' : null), c.conversationId);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                    >
                      <MessageSquareDot size={16} className="text-slate-400 dark:text-slate-500 shrink-0" />
                      Marcar como não lida
                    </button>
                  )}
                </div>
              )}
              </div>
            );
          })}
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
                <ArrowLeft size={16} /> Contatos
              </button>
            </div>

            {/* Barra de CRM: mostra a pipeline/etapa do lead do contato (com
                atalho pro card) ou oferece criar o lead na hora */}
            <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card">
              {selected.isGroup ? (
                /* Grupo: não tem contato nem lead; só o rótulo */
                <span className="flex items-center gap-2 min-w-0 text-xs text-slate-500 dark:text-slate-400">
                  <Users size={14} className="shrink-0" />
                  <span className="truncate">
                    Grupo do WhatsApp
                    {selected.participantsCount ? ` · ${selected.participantsCount} participantes` : ''}
                    . Grupos não viram contato nem lead.
                  </span>
                </span>
              ) : selectedDeal ? (
                <>
                  <span className="flex items-center gap-2 min-w-0 text-xs text-slate-600 dark:text-slate-300">
                    <KanbanSquare size={14} className="text-primary-500 shrink-0" />
                    <span className="font-bold truncate">{selectedDealBoard?.name ?? 'Board'}</span>
                    <span className="text-slate-300 dark:text-slate-600 shrink-0">•</span>
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${selectedDealStage?.color ?? 'bg-slate-400'}`} />
                      <span className="truncate">{selectedDealStage?.label ?? 'Etapa'}</span>
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => router.push(`/boards?deal=${selectedDeal.id}`)}
                    className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 border border-primary-200 dark:border-primary-500/30 transition-colors"
                  >
                    Abrir lead <ExternalLink size={12} />
                  </button>
                </>
              ) : selected.contactId ? (
                <>
                  <span className="text-xs text-slate-400 italic truncate">Este contato ainda não tem lead.</span>
                  <button
                    type="button"
                    onClick={openLeadModal}
                    className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors"
                  >
                    <Plus size={13} /> Criar lead
                  </button>
                </>
              ) : (
                <>
                  <span className="text-xs text-amber-600 dark:text-amber-400 truncate">
                    Número sem contato no CRM. Adicione pra criar o lead.
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      openNewContactModal({
                        name: selected.name !== selected.phone ? selected.name : '',
                        phone: selected.phone,
                      })
                    }
                    className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors"
                  >
                    <UserPlus size={13} /> Adicionar contato
                  </button>
                </>
              )}
            </div>

            <div className="flex-1 min-h-0">
              {/* key={phone} garante reset total do composer/busca ao trocar de conversa */}
              <DealWhatsAppChat
                key={selected.isGroup ? `group|${selected.conversationId}` : `${selected.phone}|${selected.connectionId ?? 'all'}`}
                connectionId={selected.connectionId ?? null}
                contact={
                  selected.isGroup ? null : { id: selected.contactId || selected.phone, name: selected.name, phone: selected.phone }
                }
                group={
                  selected.isGroup
                    ? {
                        conversationId: selected.conversationId as string,
                        name: selected.name,
                        participantsCount: selected.participantsCount ?? null,
                      }
                    : null
                }
                templateContext={{
                  'contato.email': (selected.contactId && contacts.find(c => c.id === selected.contactId)?.email) || '',
                  'lead.titulo': selectedDeal?.title || '',
                  'lead.valor': selectedDeal
                    ? Number(selectedDeal.value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                    : '',
                  'lead.etapa': selectedDealStage?.label || '',
                  'responsavel.nome': selectedDeal?.owner?.name || '',
                  'escritorio.nome': profile?.organization_name || '',
                }}
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
              Escolha um contato ao lado pra conversar. Quem já trocou mensagem fica no topo,
              com a prévia da última conversa. Tudo aparece aqui e no card do lead.
            </p>
            {!connected && (
              <Link
                href="/conexao-whatsapp"
                className="mt-1 text-xs font-bold text-amber-600 dark:text-amber-400 hover:underline"
              >
                WhatsApp desconectado. Conectar na aba Conexão
              </Link>
            )}
          </div>
        )}
      </section>

      {/* ============ MODAL: Novo grupo (API oficial) ============ */}
      {newGroupOpen && (
        <div
          className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
          onMouseDown={e => {
            if (e.target === e.currentTarget && !ngBusy) setNewGroupOpen(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Novo grupo"
        >
          <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white dark:bg-dark-card shadow-2xl border border-slate-200 dark:border-white/10 overflow-hidden">
            <div className="flex items-start gap-3 px-4 py-3 border-b border-slate-200 dark:border-white/10">
              <span className="mt-0.5 w-8 h-8 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-300 flex items-center justify-center shrink-0">
                <Users size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-900 dark:text-white">Novo grupo</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Grupo da WhatsApp API oficial: você cria, manda o link de convite e as pessoas entram (até 8).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNewGroupOpen(false)}
                disabled={ngBusy}
                className="shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-50"
                aria-label="Fechar"
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-4 py-3 space-y-3">
              {metaConns.length > 1 && (
                <label className="block">
                  <span className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Número</span>
                  <select
                    value={ngConn}
                    onChange={e => setNgConn(e.target.value)}
                    className="w-full bg-slate-100 dark:bg-black/20 border border-transparent focus:border-emerald-400 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none"
                  >
                    {metaConns.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.phoneNumber || c.profileName || 'Número'}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block">
                <span className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Nome do grupo</span>
                <input
                  autoFocus
                  type="text"
                  value={ngSubject}
                  maxLength={128}
                  onChange={e => setNgSubject(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleCreateGroup();
                    }
                  }}
                  placeholder="Ex.: Atendimento Dra. Ana"
                  className="w-full bg-slate-100 dark:bg-black/20 border border-transparent focus:border-emerald-400 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Descrição (opcional)</span>
                <textarea
                  value={ngDesc}
                  maxLength={2048}
                  onChange={e => setNgDesc(e.target.value)}
                  rows={2}
                  placeholder="Para que serve o grupo"
                  className="w-full bg-slate-100 dark:bg-black/20 border border-transparent focus:border-emerald-400 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none resize-none"
                />
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-200 dark:border-white/10">
              <button
                type="button"
                onClick={() => setNewGroupOpen(false)}
                disabled={ngBusy}
                className="h-9 px-3 inline-flex items-center rounded-xl border border-slate-200 dark:border-white/10 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleCreateGroup()}
                disabled={!ngSubject.trim() || ngBusy}
                className="h-9 px-4 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold"
              >
                {ngBusy ? 'Criando...' : 'Criar grupo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ MODAL: Novo contato ============ */}
      {newContactOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4"
          onClick={() => { if (!ncBusy) setNewContactOpen(false); }}
        >
          <div
            className="w-full max-w-sm bg-white dark:bg-dark-card rounded-2xl border border-slate-200 dark:border-white/10 shadow-2xl p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-display font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <UserPlus size={16} className="text-emerald-500" /> Novo contato
              </h2>
              <button
                type="button"
                onClick={() => setNewContactOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                aria-label="Fechar"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nome *</label>
                <input
                  autoFocus
                  type="text"
                  value={ncName}
                  onChange={e => setNcName(e.target.value)}
                  placeholder="Ex: Maria Silva"
                  className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Telefone (WhatsApp) *</label>
                <input
                  type="tel"
                  value={ncPhone}
                  onChange={e => setNcPhone(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void handleCreateContact(); }}
                  placeholder="Ex: (66) 99999-9999"
                  className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Email (opcional)</label>
                <input
                  type="email"
                  value={ncEmail}
                  onChange={e => setNcEmail(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void handleCreateContact(); }}
                  placeholder="email@exemplo.com"
                  className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setNewContactOpen(false)}
                disabled={ncBusy}
                className="px-3 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleCreateContact()}
                disabled={ncBusy || !ncName.trim() || !ncPhone.trim()}
                className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {ncBusy ? 'Criando...' : 'Criar e abrir chat'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ MODAL: Criar lead (pipeline + etapa) ============ */}
      {leadModalOpen && selected && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4"
          onClick={() => { if (!leadBusy) setLeadModalOpen(false); }}
        >
          <div
            className="w-full max-w-sm bg-white dark:bg-dark-card rounded-2xl border border-slate-200 dark:border-white/10 shadow-2xl p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-display font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <KanbanSquare size={16} className="text-emerald-500" /> Criar lead
              </h2>
              <button
                type="button"
                onClick={() => setLeadModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                aria-label="Fechar"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 truncate">
              Para <span className="font-semibold text-slate-700 dark:text-slate-200">{selected.name}</span>
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Pipeline (board)</label>
                <select
                  value={leadBoardId}
                  onChange={e => {
                    const boardId = e.target.value;
                    setLeadBoardId(boardId);
                    // trocar de board reposiciona a etapa na primeira do novo board
                    setLeadStageId(boards.find(b => b.id === boardId)?.stages[0]?.id || '');
                  }}
                  className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {boards.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Etapa</label>
                <select
                  value={leadStageId}
                  onChange={e => setLeadStageId(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {(boards.find(b => b.id === leadBoardId)?.stages ?? []).map(s => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setLeadModalOpen(false)}
                disabled={leadBusy}
                className="px-3 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleCreateLead()}
                disabled={leadBusy || !leadBoardId || !leadStageId}
                className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {leadBusy ? 'Criando...' : 'Criar lead'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatsPage;
