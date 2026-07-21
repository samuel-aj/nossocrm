'use client';

import React, { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Check, FileText, KeyRound, MessageCircle, Pencil, Plus, RefreshCw, Trash2, Variable, X } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { TEMPLATE_VARIABLES, previewTemplate, toMetaName } from '@/lib/messageTemplates';

// ---------------------------------------------------------------------------
// Aba MODELOS (Configurações): modelos de mensagem da organização.
//   - Mensagem geral: texto livre pra usar nas conversas do dia a dia.
//   - WhatsApp API (Meta): exige categoria (Utilidade | Marketing) e idioma;
//     esses modelos passam por aprovação da Meta antes de poder enviar fora
//     da janela de 24h (o envio pra aprovação entra com a conexão API ativa).
// O corpo aceita variáveis do lead/contato que o CRM substitui na hora do uso.
// ---------------------------------------------------------------------------

type TemplateType = 'general' | 'whatsapp_api';
type TemplateCategory = 'UTILITY' | 'MARKETING';

interface MessageTemplate {
  id: string;
  name: string;
  type: TemplateType;
  category: TemplateCategory | null;
  language: string;
  body: string;
  meta_name: string | null;
  meta_status: string | null;
}

const LANGUAGES = [
  { value: 'pt_BR', label: 'Português (BR)' },
  { value: 'en_US', label: 'Inglês (EUA)' },
  { value: 'es_ES', label: 'Espanhol' },
];

// Status de aprovação da Meta -> rótulo e cor do badge
const META_STATUS_BADGE: Record<string, { label: string; className: string }> = {
  APPROVED: { label: 'Aprovado', className: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' },
  PENDING: { label: 'Em análise', className: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' },
  REJECTED: { label: 'Rejeitado', className: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' },
};

const previewBody = previewTemplate;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) },
    ...init,
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error || `Falha (HTTP ${res.status})`);
  return json;
}

export function MessageTemplatesManager() {
  const qc = useQueryClient();
  const { addToast } = useToast();
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  // Aba interna ativa: o TIPO do modelo é a própria aba (Gerais | WhatsApp API)
  const [tab, setTab] = useState<TemplateType>('general');
  const [category, setCategory] = useState<TemplateCategory>('UTILITY');
  const [language, setLanguage] = useState('pt_BR');
  const [body, setBody] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const listQ = useQuery<{ data: MessageTemplate[] }>({
    queryKey: ['messageTemplates'],
    queryFn: () => fetchJson('/api/message-templates'),
  });

  // Conexão do WhatsApp da org: os modelos da API só funcionam com a conexão
  // no modo API oficial (Meta). Conexão por QR code não cria template na Meta.
  const connQ = useQuery<{
    connected: boolean;
    connection: { provider: string | null; status: string; phoneNumber: string | null; profileName: string | null } | null;
  }>({
    queryKey: ['waConnection'],
    queryFn: () => fetchJson('/api/whatsapp/connection'),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });
  const connReady = !!connQ.data;
  const apiConnected = !!connQ.data?.connected && connQ.data?.connection?.provider === 'evolution_business';
  const qrConnected = !!connQ.data?.connected && !apiConnected;
  // Trava o formulário da aba API enquanto o escritório não conectar a API oficial
  const apiLocked = tab === 'whatsapp_api' && connReady && !apiConnected;
  const templates = useMemo(() => listQ.data?.data ?? [], [listQ.data]);
  const generalTemplates = templates.filter(t => t.type === 'general');
  const apiTemplates = templates.filter(t => t.type === 'whatsapp_api');

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setCategory('UTILITY');
    setLanguage('pt_BR');
    setBody('');
  };

  const switchTab = (next: TemplateType) => {
    if (next === tab) return;
    setTab(next);
    resetForm();
    setConfirmDeleteId(null);
  };

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim(),
        type: tab,
        category: tab === 'whatsapp_api' ? category : null,
        language,
        body,
      };
      return editingId
        ? fetchJson(`/api/message-templates/${encodeURIComponent(editingId)}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          })
        : fetchJson('/api/message-templates', { method: 'POST', body: JSON.stringify(payload) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messageTemplates'] });
      addToast(editingId ? 'Modelo atualizado!' : 'Modelo criado!', 'success');
      resetForm();
    },
    onError: e => addToast((e as Error).message, 'error'),
  });

  const deleteMut = useMutation({
    mutationFn: (t: MessageTemplate) =>
      fetchJson(`/api/message-templates/${encodeURIComponent(t.id)}`, { method: 'DELETE' }),
    onSuccess: (_data, t) => {
      qc.invalidateQueries({ queryKey: ['messageTemplates'] });
      addToast(
        t.type === 'whatsapp_api'
          ? 'Modelo removido do CRM. O template continua na Meta (remova pelo painel dela se quiser).'
          : 'Modelo removido.',
        'info'
      );
      setConfirmDeleteId(null);
    },
    onError: e => {
      addToast((e as Error).message, 'error');
      setConfirmDeleteId(null);
    },
  });

  // Sincroniza com a META: atualiza status de aprovação e importa templates
  // que existem lá e o CRM ainda não conhece
  const syncMut = useMutation({
    mutationFn: () =>
      fetchJson<{ updated: number; imported: number; total_meta: number }>(
        '/api/message-templates/sync',
        { method: 'POST', body: JSON.stringify({}) }
      ),
    onSuccess: r => {
      qc.invalidateQueries({ queryKey: ['messageTemplates'] });
      addToast(
        `Sincronizado com a Meta: ${r.total_meta} template${r.total_meta === 1 ? '' : 's'} lá, ${r.imported} importado${r.imported === 1 ? '' : 's'}.`,
        'success'
      );
    },
    onError: e => addToast((e as Error).message, 'error'),
  });

  const startEditing = (t: MessageTemplate) => {
    setEditingId(t.id);
    setName(t.name);
    setTab(t.type);
    setCategory(t.category ?? 'UTILITY');
    setLanguage(t.language || 'pt_BR');
    setBody(t.body);
    bodyRef.current?.focus();
  };

  // Insere a variável na posição do cursor do corpo (mantendo o foco)
  const insertVariable = (token: string) => {
    const el = bodyRef.current;
    if (!el) {
      setBody(prev => prev + token);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const canSave = name.trim() !== '' && body.trim() !== '';

  const renderTemplateCard = (t: MessageTemplate) => (
    <div
      key={t.id}
      className={`flex items-start justify-between gap-3 p-3 bg-white dark:bg-white/5 border rounded-lg group transition-colors ${
        editingId === t.id
          ? 'border-amber-400 dark:border-amber-500/50 ring-1 ring-amber-400/30'
          : 'border-slate-200 dark:border-white/10 hover:border-primary-300 dark:hover:border-primary-500/50'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{t.name}</p>
          {t.type === 'whatsapp_api' && (
            <>
              <span
                className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                  t.category === 'MARKETING'
                    ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400'
                    : 'bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400'
                }`}
              >
                {t.category === 'MARKETING' ? 'Marketing' : 'Utilidade'}
              </span>
              <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400">
                {t.language}
              </span>
              {(() => {
                const badge = t.meta_status ? META_STATUS_BADGE[t.meta_status] : null;
                return (
                  <span
                    className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                      badge?.className ?? 'bg-slate-100 dark:bg-white/10 text-slate-400'
                    }`}
                    title={t.meta_name ? `Nome na Meta: ${t.meta_name}` : undefined}
                  >
                    {badge?.label ?? 'Não sincronizado'}
                  </span>
                );
              })()}
            </>
          )}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2 whitespace-pre-wrap break-words">
          {t.body}
        </p>
      </div>
      <div className="flex gap-1 shrink-0">
        {t.type === 'general' && (
          <button
            type="button"
            onClick={() => startEditing(t)}
            className="text-slate-400 hover:text-amber-500 p-2 rounded hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
            title="Editar modelo"
          >
            <Pencil size={15} />
          </button>
        )}
        {confirmDeleteId === t.id ? (
          <button
            type="button"
            onClick={() => deleteMut.mutate(t)}
            className="text-[11px] font-bold text-red-600 dark:text-red-400 px-2 py-0.5 rounded bg-red-50 dark:bg-red-900/20"
          >
            Confirmar?
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setConfirmDeleteId(t.id);
              window.setTimeout(() => setConfirmDeleteId(cur => (cur === t.id ? null : cur)), 3000);
            }}
            className="text-slate-400 hover:text-red-500 p-2 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            title="Remover modelo"
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl border border-slate-200 dark:border-white/10 p-6">
      {/* mesmos 12px: título, texto e conteúdo */}
      <div className="flex items-center gap-2 mb-3">
        <span className="w-8 h-8 rounded-xl bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400 flex items-center justify-center">
          <FileText size={16} />
        </span>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Modelos de mensagem</h2>
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
        Mensagens gerais ficam prontas pra enviar direto no chat, como se fossem digitadas. Modelos
        do <span className="font-semibold">WhatsApp API</span> são sincronizados com a Meta: criar
        aqui cria lá, e o status de aprovação aparece na lista.
      </p>

      {/* Abas internas: cada tipo tem seu formulário e sua lista */}
      <div className="flex items-center gap-2 mb-4">
        {([
          { id: 'general' as const, label: 'Mensagens gerais', icon: MessageCircle },
          { id: 'whatsapp_api' as const, label: 'WhatsApp API', icon: KeyRound },
        ]).map(t => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => switchTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                active
                  ? 'border-primary-500/50 bg-primary-500/10 text-primary-700 dark:text-primary-300'
                  : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
              }`}
            >
              <t.icon size={14} /> {t.label}
              {/* Aviso na própria aba: API oficial ainda não conectada */}
              {t.id === 'whatsapp_api' && connReady && !apiConnected && (
                <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>

      {/* Status da conexão API oficial: deixa claro que os modelos desta aba
          dependem do WhatsApp API da Meta conectado */}
      {tab === 'whatsapp_api' && connReady && (
        apiConnected ? (
          <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-900/15 text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            WhatsApp API oficial conectado
            {connQ.data?.connection?.phoneNumber && (
              <span className="font-normal text-emerald-600/80 dark:text-emerald-400/80 truncate">
                · {connQ.data.connection.phoneNumber}
              </span>
            )}
          </div>
        ) : (
          <div className="mb-4 p-4 rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-900/15">
            <div className="flex items-start gap-3">
              <span className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <AlertTriangle size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-amber-800 dark:text-amber-300 mb-1">
                  Conecte o WhatsApp API oficial pra usar estes modelos
                </p>
                <p className="text-xs text-amber-700/90 dark:text-amber-400/90">
                  Os modelos desta aba são criados direto na Meta. Por isso, o WhatsApp do
                  escritório precisa estar conectado no modo{' '}
                  <span className="font-semibold">API oficial (Meta)</span>.
                  {qrConnected &&
                    ' Seu WhatsApp está conectado por QR code, que não usa a API oficial.'}{' '}
                  Enquanto isso, criar e sincronizar modelos fica bloqueado. As mensagens gerais
                  seguem funcionando normalmente.
                </p>
                <Link
                  href="/conexao-whatsapp"
                  className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold transition-colors"
                >
                  Conectar WhatsApp API <ArrowRight size={13} />
                </Link>
              </div>
            </div>
          </div>
        )
      )}

      {/* Formulário de criação/edição (trava enquanto a API oficial não conectar) */}
      <div
        inert={apiLocked}
        className={`p-4 rounded-xl border transition-all mb-6 ${
          editingId
            ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-500/20'
            : 'bg-slate-50 dark:bg-black/20 border-slate-200 dark:border-white/5'
        } ${apiLocked ? 'opacity-50 select-none' : ''}`}
      >
        {editingId && (
          <div className="flex items-center gap-2 mb-3 text-amber-600 dark:text-amber-400 text-xs font-bold uppercase tracking-wider">
            <Pencil size={12} /> Editando modelo
          </div>
        )}

        <div className="mb-3">
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nome do modelo</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Ex: Boas-vindas, Lembrete de audiência"
            className="w-full bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
          />
        </div>

        {/* Opções exclusivas do WhatsApp API: categoria da Meta + idioma */}
        {tab === 'whatsapp_api' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3 animate-in slide-in-from-top-2 fade-in duration-200">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Categoria (Meta)</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCategory('UTILITY')}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
                    category === 'UTILITY'
                      ? 'border-sky-500/60 bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300'
                      : 'border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10'
                  }`}
                >
                  Utilidade
                </button>
                <button
                  type="button"
                  onClick={() => setCategory('MARKETING')}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
                    category === 'MARKETING'
                      ? 'border-violet-500/60 bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300'
                      : 'border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10'
                  }`}
                >
                  Marketing
                </button>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                Utilidade: avisos e atualizações do caso. Marketing: ofertas e divulgação.
              </p>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Idioma</label>
              <select
                value={language}
                onChange={e => setLanguage(e.target.value)}
                className="w-full bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
              >
                {LANGUAGES.map(l => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="mb-3">
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Mensagem</label>
          <textarea
            ref={bodyRef}
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder={'Ex: Olá {{contato.nome}}! Sobre o seu processo de {{lead.titulo}}, temos novidades.'}
            className="w-full min-h-[110px] bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white resize-y"
          />
        </div>

        {/* Variáveis do lead e contato: clicou, insere na posição do cursor */}
        <div className="mb-3">
          <p className="text-xs font-bold text-slate-500 uppercase mb-1.5 flex items-center gap-1.5">
            <Variable size={12} /> Variáveis do lead e contato
          </p>
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATE_VARIABLES.map(v => (
              <button
                key={v.key}
                type="button"
                onClick={() => insertVariable(v.key)}
                title={`${v.label} (ex: ${v.sample})`}
                className="px-2 py-1 rounded-md bg-primary-500/10 hover:bg-primary-500/20 text-primary-700 dark:text-primary-300 text-[11px] font-mono font-semibold transition-colors"
              >
                {v.key}
              </button>
            ))}
          </div>
        </div>

        {/* Preview com valores de exemplo */}
        {body.trim() !== '' && (
          <div className="mb-3 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 p-3">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              Prévia (com valores de exemplo)
            </p>
            <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words">
              {previewBody(body)}
            </p>
          </div>
        )}

        {tab === 'whatsapp_api' && (
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-3 space-y-1">
            <p>
              🔄 Criar este modelo <span className="font-semibold">cria o template direto na Meta</span> e
              ele entra em análise (precisa da conexão WhatsApp API ativa na aba Conexão).
            </p>
            {name.trim() !== '' && (
              <p>
                Nome na Meta: <span className="font-mono font-semibold">{toMetaName(name)}</span>
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 px-3 py-2 rounded-lg text-sm font-bold transition-colors border border-slate-200 dark:border-white/10 inline-flex items-center gap-1.5"
            >
              <X size={14} /> Cancelar
            </button>
          )}
          <button
            type="button"
            onClick={() => saveMut.mutate()}
            disabled={!canSave || saveMut.isPending || apiLocked}
            className={`${
              editingId ? 'bg-amber-600 hover:bg-amber-500' : 'bg-primary-600 hover:bg-primary-500'
            } text-white px-4 py-2 rounded-lg text-sm font-bold inline-flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {editingId ? <Check size={15} /> : <Plus size={15} />}
            {saveMut.isPending ? 'Salvando...' : editingId ? 'Salvar' : 'Criar modelo'}
          </button>
        </div>
      </div>

      {/* Lista da aba ativa */}
      {listQ.isLoading ? (
        <p className="text-sm text-slate-400 text-center py-6">Carregando modelos...</p>
      ) : tab === 'general' ? (
        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-300 flex items-center gap-1.5">
            <MessageCircle size={12} className="text-emerald-500" />
            Mensagens gerais
            <span className="font-normal text-slate-400 normal-case">
              · {generalTemplates.length} modelo{generalTemplates.length === 1 ? '' : 's'}
            </span>
          </p>
          {generalTemplates.length > 0 ? (
            generalTemplates.map(renderTemplateCard)
          ) : (
            <p className="text-sm text-slate-400 italic px-1">
              Nenhum modelo geral ainda. Eles ficam disponíveis pra enviar direto no chat.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-300 flex items-center gap-1.5">
              <KeyRound size={12} className="text-sky-500" />
              WhatsApp API (Meta)
              <span className="font-normal text-slate-400 normal-case">
                · {apiTemplates.length} modelo{apiTemplates.length === 1 ? '' : 's'}
              </span>
            </p>
            <button
              type="button"
              onClick={() => syncMut.mutate()}
              disabled={syncMut.isPending || apiLocked}
              title={
                apiLocked
                  ? 'Conecte o WhatsApp API oficial na aba Conexão pra sincronizar'
                  : 'Atualiza o status de aprovação e importa templates que já existem na Meta'
              }
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-500/30 hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={syncMut.isPending ? 'animate-spin' : ''} />
              {syncMut.isPending ? 'Sincronizando...' : 'Sincronizar com a Meta'}
            </button>
          </div>
          {apiTemplates.length > 0 ? (
            apiTemplates.map(renderTemplateCard)
          ) : (
            <p className="text-sm text-slate-400 italic px-1">
              {apiLocked
                ? 'Nenhum modelo da API ainda. Conecte o WhatsApp API oficial pra criar e sincronizar modelos.'
                : 'Nenhum modelo da API ainda. Sincronize pra importar os templates que já existem na Meta, ou crie um novo acima.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
