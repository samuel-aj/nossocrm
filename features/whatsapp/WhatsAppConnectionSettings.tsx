'use client';

/**
 * Página Conexão (grupo WhatsApp do menu lateral).
 *
 * Conecta o WhatsApp DESTA organização (1 número por org): o admin clica em
 * "Conectar", o servidor cria a instância da org na Evolution e a tela mostra
 * o QR ao vivo (auto-renovado) até o número ser pareado. Super admin vê sempre
 * a conexão da organização ATIVA — cada cliente tem a sua.
 */
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, ExternalLink, KeyRound, Loader2, MessageCircle, QrCode, Unplug } from 'lucide-react';
import { useToast } from '@/context/ToastContext';

interface WaConnectionInfo {
  id: string;
  provider: string;
  instanceName: string;
  baseUrl: string | null;
  phoneNumber: string | null;
  profileName: string | null;
  status: 'disconnected' | 'connecting' | 'connected' | string;
}

interface ConnResponse {
  connected: boolean;
  connection: WaConnectionInfo | null;
  /** Só pra admin: URL e verify token do webhook da Meta (modo API oficial) */
  metaWebhook?: { url: string; verifyToken: string } | null;
  /** Só pra admin (modo API oficial): credenciais salvas, pra edição abrir preenchida */
  metaCredentials?: { token: string | null; phoneNumberId: string | null; wabaId: string | null } | null;
}

interface QrResponse {
  state: string;
  qrBase64?: string;
  pairingCode?: string;
  error?: string;
}

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

export function WhatsAppConnectionSettings() {
  const qc = useQueryClient();
  const { addToast } = useToast();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const connQ = useQuery<ConnResponse>({
    queryKey: ['waConnection'],
    queryFn: () => fetchJson<ConnResponse>('/api/whatsapp/connection'),
    // aguardando pareamento: checa rápido; conectado/sem conexão: devagar
    refetchInterval: q =>
      q.state.data?.connection && !q.state.data.connected ? 4000 : 30000,
    refetchOnWindowFocus: true,
  });

  const conn = connQ.data?.connection ?? null;
  const connected = !!connQ.data?.connected;
  const metaWebhook = connQ.data?.metaWebhook ?? null;

  const copyValue = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      addToast(`${label} copiado!`, 'success');
    } catch {
      addToast('Não consegui copiar. Selecione e copie manualmente.', 'error');
    }
  };
  // Modo API oficial da Meta (Cloud API): sem QR/pareamento
  // "API oficial" cobre os dois backends: via Evolution (evolution_business) e
  // DIRETO na Meta (meta_cloud). A UI trata os dois igual (sem QR, credenciais).
  const isBusiness = ['evolution_business', 'meta_cloud'].includes((conn?.provider || '').toLowerCase());

  // O QR só abre depois que o usuário ESCOLHE esse modo no seletor — mesmo
  // que já exista uma conexão QR desconectada de antes (senão o seletor
  // nunca apareceria pra quem já conectou alguma vez).
  const [qrFlowActive, setQrFlowActive] = useState(false);
  const waitingScan = !!conn && !connected && !isBusiness && qrFlowActive;
  // Desconectado (com ou sem conexão anterior) = seletor de modo na tela
  const showChooser = !connQ.isLoading && !connected && !waitingScan;

  // Form do modo API oficial
  const [bizOpen, setBizOpen] = useState(false);
  const [bizToken, setBizToken] = useState('');
  const [bizNumberId, setBizNumberId] = useState('');
  const [bizWabaId, setBizWabaId] = useState('');

  // Abre o form da API oficial PREENCHIDO com o que está salvo (admin quer
  // ver/conferir o token, Phone Number ID e WABA ID atuais). Fechar só fecha.
  const metaCreds = connQ.data?.metaCredentials ?? null;
  const toggleBizForm = () => {
    const opening = !bizOpen;
    if (opening && metaCreds) {
      setBizToken(metaCreds.token ?? '');
      setBizNumberId(metaCreds.phoneNumberId ?? '');
      setBizWabaId(metaCreds.wabaId ?? '');
    }
    setBizOpen(opening);
  };

  const qrQ = useQuery<QrResponse>({
    queryKey: ['waConnectionQr'],
    queryFn: () => fetchJson<QrResponse>('/api/whatsapp/connection/qr'),
    enabled: waitingScan,
    // o QR da Evolution expira (~40s): renova sozinho antes disso
    refetchInterval: waitingScan ? 25000 : false,
  });

  const createMut = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      fetchJson<{ connection: WaConnectionInfo }>('/api/whatsapp/connection', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: (_data, payload) => {
      qc.invalidateQueries({ queryKey: ['waConnection'] });
      qc.invalidateQueries({ queryKey: ['waConnectionQr'] });
      const mode = (payload as { mode?: string }).mode;
      if (mode === 'business' || mode === 'meta_cloud') {
        setBizOpen(false);
        setBizToken('');
        setBizNumberId('');
        setBizWabaId('');
        setQrFlowActive(false);
        addToast('WhatsApp API oficial conectado! Configure o webhook e pronto.', 'success');
      } else {
        setQrFlowActive(true);
        addToast('Instância criada. Escaneie o QR pra conectar o número.', 'success');
      }
    },
    onError: e => addToast((e as Error).message, 'error'),
  });

  // Entra no fluxo do QR: reaproveita a instância existente da org (a rota do
  // QR tem self-healing) ou cria uma nova quando não há / quando era business.
  const startQrFlow = () => {
    if (conn && !isBusiness) {
      setQrFlowActive(true);
      qc.invalidateQueries({ queryKey: ['waConnectionQr'] });
      return;
    }
    createMut.mutate({ autoCreate: true });
  };

  const disconnectMut = useMutation({
    mutationFn: () => fetchJson<{ ok: boolean }>('/api/whatsapp/connection', { method: 'DELETE' }),
    onSuccess: () => {
      setConfirmDisconnect(false);
      qc.invalidateQueries({ queryKey: ['waConnection'] });
      qc.invalidateQueries({ queryKey: ['waConnectionQr'] });
      addToast('Número desconectado.', 'success');
    },
    onError: e => {
      setConfirmDisconnect(false);
      addToast((e as Error).message, 'error');
    },
  });

  // Conectado via API oficial: o mesmo form vira "edição" (o POST recria a
  // instância com as credenciais novas por baixo, sem derrubar as conversas)
  const isEditingBiz = connected && isBusiness;

  // Form de credenciais da Meta, compartilhado entre o seletor de modo
  // (primeira conexão) e o painel de conectado (edição)
  const bizCredentialsForm = (
    <div className="rounded-2xl border border-sky-200 dark:border-sky-500/25 bg-sky-50/50 dark:bg-sky-900/10 p-5 space-y-3">
      <p className="text-sm font-bold text-slate-900 dark:text-white">
        {isEditingBiz ? 'Editar conexão da API oficial' : 'Credenciais da Meta (Cloud API)'}
      </p>
      {isEditingBiz && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          A conexão continua ativa enquanto você edita: salvar substitui o token e o número na
          hora, sem precisar desconectar. Preencha os campos com os valores novos.
        </p>
      )}

      {/* Onde pegar cada credencial no painel da Meta */}
      <div className="rounded-xl border border-sky-200/70 dark:border-sky-500/20 bg-white dark:bg-black/20 p-3.5 text-[11px] text-slate-600 dark:text-slate-300 space-y-2">
        <p className="font-bold text-slate-700 dark:text-slate-200">Onde pegar as credenciais:</p>
        <p>
          <span className="font-semibold">1. Phone Number ID e WABA ID:</span> no painel de
          apps da Meta, abra (ou crie) o app com o produto WhatsApp e vá em{' '}
          <span className="font-semibold">WhatsApp, Configuração da API</span>. Os dois IDs
          aparecem nessa tela.
        </p>
        <a
          href="https://developers.facebook.com/apps/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 font-bold text-sky-600 dark:text-sky-400 hover:underline"
        >
          Abrir painel de apps da Meta <ExternalLink size={11} />
        </a>
        <p>
          <span className="font-semibold">2. Token permanente:</span> nas configurações do
          negócio, em <span className="font-semibold">Usuários, Usuários do sistema</span>,
          crie um usuário do sistema (função Administrador), adicione o app com controle
          total em Adicionar ativos, e clique em Gerar token marcando as permissões{' '}
          <span className="font-mono">whatsapp_business_messaging</span> e{' '}
          <span className="font-mono">whatsapp_business_management</span> (validade: nunca
          expira).
        </p>
        <a
          href="https://business.facebook.com/settings/system-users"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 font-bold text-sky-600 dark:text-sky-400 hover:underline"
        >
          Abrir usuários do sistema da Business Manager <ExternalLink size={11} />
        </a>
      </div>

      <div>
        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Token permanente *</label>
        <input
          type="password"
          value={bizToken}
          onChange={e => setBizToken(e.target.value)}
          placeholder="Token do usuário de sistema da Business Manager"
          className="w-full bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-sky-500 font-mono"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Phone Number ID *</label>
          <input
            type="text"
            value={bizNumberId}
            onChange={e => setBizNumberId(e.target.value)}
            placeholder="Ex: 123456789012345"
            className="w-full bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-sky-500 font-mono"
          />
          <p className="text-[10px] text-slate-400 mt-1">É o ID do número no painel da Meta, não o telefone.</p>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">WABA ID (opcional)</label>
          <input
            type="text"
            value={bizWabaId}
            onChange={e => setBizWabaId(e.target.value)}
            placeholder="WhatsApp Business Account ID"
            className="w-full bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-sky-500 font-mono"
          />
          <p className="text-[10px] text-slate-400 mt-1">Necessário no futuro pra templates.</p>
        </div>
      </div>
      {/* Passo 3: webhook do recebimento, com os valores prontos pra
          colar no painel da Meta (sem isso o envio funciona mas as
          respostas dos clientes não chegam no CRM). Os valores são POR
          CONEXÃO (o secret nasce ao conectar) — antes disso, orienta. */}
      {!metaWebhook && (
        <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-3.5 text-[11px] text-slate-600 dark:text-slate-300">
          <p className="font-bold text-slate-700 dark:text-slate-200 mb-1">3. Webhook (pra receber as respostas):</p>
          <p>
            Depois de clicar em Conectar, a <span className="font-semibold">URL de callback</span> e o{' '}
            <span className="font-semibold">token de verificação</span> desta organização aparecem aqui,
            prontos pra colar no painel do app da Meta (WhatsApp, Configuração, Webhook) e assinar o campo{' '}
            <span className="font-semibold">messages</span>.
          </p>
        </div>
      )}
      {metaWebhook && (
        <div className="rounded-xl border border-sky-200/70 dark:border-sky-500/20 bg-white dark:bg-black/20 p-3.5 text-[11px] text-slate-600 dark:text-slate-300 space-y-2.5">
          <p className="font-bold text-slate-700 dark:text-slate-200">
            3. Webhook (pra receber as respostas dos clientes):
          </p>
          <p>
            No painel do app da Meta, vá em{' '}
            <span className="font-semibold">WhatsApp, Configuração</span> e, na seção
            Webhook, clique em Editar e cole os dois valores abaixo. Depois de verificar,
            clique em Gerenciar e assine o campo{' '}
            <span className="font-semibold">messages</span>. Sem esse passo o envio
            funciona, mas as respostas não chegam no CRM.
          </p>
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase mb-0.5">URL de callback</p>
            <div className="flex items-center gap-1.5">
              <code className="flex-1 truncate bg-slate-100 dark:bg-white/10 rounded-md px-2 py-1.5 font-mono text-[11px] text-slate-700 dark:text-slate-200">
                {metaWebhook.url}
              </code>
              <button
                type="button"
                onClick={() => copyValue(metaWebhook.url, 'URL de callback')}
                title="Copiar URL de callback"
                className="shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-colors"
              >
                <Copy size={13} />
              </button>
            </div>
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase mb-0.5">Token de verificação</p>
            <div className="flex items-center gap-1.5">
              <code className="flex-1 truncate bg-slate-100 dark:bg-white/10 rounded-md px-2 py-1.5 font-mono text-[11px] text-slate-700 dark:text-slate-200">
                {metaWebhook.verifyToken}
              </code>
              <button
                type="button"
                onClick={() => copyValue(metaWebhook.verifyToken, 'Token de verificação')}
                title="Copiar token de verificação"
                className="shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-colors"
              >
                <Copy size={13} />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-1 border-t border-sky-200/60 dark:border-sky-500/20 pt-3">
        <p>
          ⚠️ <span className="font-semibold">Janela de 24h:</span> pela regra da Meta, fora de 24h
          após a última mensagem do cliente só é possível enviar templates aprovados.
          Mensagens livres são recusadas (o CRM mostra a falha no chat).
        </p>
      </div>
      <button
        type="button"
        onClick={() =>
          createMut.mutate({
            // Modo DIRETO na Meta (sem Evolution). Envio/recebimento falam
            // direto com a Cloud API; o webhook aponta pro próprio CRM.
            mode: 'meta_cloud',
            metaToken: bizToken.trim(),
            metaNumberId: bizNumberId.trim(),
            metaBusinessId: bizWabaId.trim() || undefined,
          })
        }
        disabled={createMut.isPending || !bizToken.trim() || !bizNumberId.trim()}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {createMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
        {isEditingBiz ? 'Salvar novas credenciais' : 'Conectar API oficial'}
      </button>
    </div>
  );

  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl border border-slate-200 dark:border-white/10 p-6">
      {/* mesmos 12px: título→texto e texto→conteúdo */}
      <div className="flex items-center gap-2 mb-3">
        <span className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
          <MessageCircle size={16} />
        </span>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">WhatsApp</h2>
        {connected && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 size={13} /> Conectado{isBusiness ? ' · API oficial' : ''}
          </span>
        )}
        {waitingScan && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300">
            <Loader2 size={13} className="animate-spin" /> Aguardando conexão
          </span>
        )}
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
        Conecte o <span className="font-semibold">WhatsApp do seu escritório</span> pra atender seus
        leads direto pelo CRM. As conversas aparecem na página Chats e na aba WhatsApp dentro do
        card de cada lead.
      </p>

      {connQ.isLoading && (
        <div className="flex items-center gap-2 text-slate-400 py-8 justify-center">
          <Loader2 className="animate-spin" size={18} /> Carregando…
        </div>
      )}

      {/* Seletor de modo: QR Code (Baileys) ou API oficial da Meta (Cloud API) */}
      {showChooser && (
        <div className="space-y-4">
          {conn && isBusiness && !connected && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              A conexão via API oficial foi desconectada. Reconecte informando as credenciais da
              Meta novamente, ou conecte via QR Code.
            </p>
          )}
          {/* Ritmo interno dos cards: ícone 12px, título 6px, texto e botão
              ancorado embaixo com respiro consistente nos dois cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Modo QR (padrão) */}
            <div className="rounded-2xl border border-slate-200 dark:border-white/10 p-5 flex flex-col">
              <span className="w-9 h-9 mb-3 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <QrCode size={18} />
              </span>
              <p className="text-sm font-bold text-slate-900 dark:text-white mb-1.5">QR Code (celular)</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed flex-1 mb-4">
                Conecta um número comum escaneando o QR com o celular. Sem custo por mensagem,
                pronto em 1 minuto.
              </p>
              <button
                type="button"
                onClick={startQrFlow}
                disabled={createMut.isPending}
                className="mt-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold transition-colors disabled:opacity-60"
              >
                {createMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <MessageCircle size={16} />}
                Conectar via QR
              </button>
            </div>

            {/* Modo API oficial (Meta Cloud API) */}
            <div className="rounded-2xl border border-slate-200 dark:border-white/10 p-5 flex flex-col">
              <span className="w-9 h-9 mb-3 rounded-xl bg-sky-100 dark:bg-sky-900/40 text-sky-600 dark:text-sky-400 flex items-center justify-center">
                <KeyRound size={18} />
              </span>
              <p className="text-sm font-bold text-slate-900 dark:text-white mb-1.5">WhatsApp API oficial (Meta)</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed flex-1 mb-4">
                Número registrado na Meta, sem QR, 100% estável e sem risco de bloqueio. Requer
                conta na Meta Business e tem cobrança por conversa.
              </p>
              <button
                type="button"
                onClick={toggleBizForm}
                className="mt-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-sky-300 dark:border-sky-500/40 text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-900/20 text-sm font-bold transition-colors"
              >
                <KeyRound size={16} />
                {bizOpen ? 'Fechar configuração' : 'Configurar API oficial'}
              </button>
            </div>
          </div>

          {/* Form de credenciais da Meta */}
          {bizOpen && bizCredentialsForm}
        </div>
      )}

      {/* Conexão criada, número ainda não pareado: QR ao vivo */}
      {waitingScan && (
        <div className="flex flex-col md:flex-row items-center gap-6">
          <div className="shrink-0 rounded-2xl border border-slate-200 dark:border-white/10 p-3 bg-white">
            {qrQ.data?.qrBase64 ? (
              // eslint-disable-next-line @next/next/no-img-element -- QR é data URI dinâmico; next/image não otimiza data URIs
              <img
                src={qrQ.data.qrBase64}
                alt="QR Code para conectar o WhatsApp"
                width={232}
                height={232}
                // a Evolution gera o QR colorido (azul) — força módulos PRETOS
                // mantendo o fundo branco, independente da cor que vier
                className="grayscale contrast-[500%]"
              />
            ) : (
              <div className="w-[232px] h-[232px] flex flex-col items-center justify-center gap-2 text-slate-400">
                <Loader2 className="animate-spin" size={22} />
                <span className="text-xs">{qrQ.isError ? 'Falha ao gerar o QR. Tentando de novo…' : 'Gerando QR…'}</span>
              </div>
            )}
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-300 space-y-2">
            <p className="font-bold text-slate-900 dark:text-white">Conecte o número do seu escritório:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Abra o WhatsApp no celular do número que vai atender</li>
              <li>
                Toque em <span className="font-semibold">⋮ (Menu) → Aparelhos conectados</span>
              </li>
              <li>
                Toque em <span className="font-semibold">Conectar um aparelho</span> e escaneie o QR
              </li>
            </ol>
            <p className="text-xs text-slate-400">
              O QR se renova sozinho a cada 25s. Assim que o número parear, esta tela atualiza pra
              &quot;Conectado&quot; automaticamente.
            </p>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => qrQ.refetch()}
                className="text-xs font-bold text-primary-600 dark:text-primary-400 hover:underline"
              >
                Gerar novo QR agora
              </button>
              <button
                type="button"
                onClick={() => setQrFlowActive(false)}
                className="text-xs font-bold text-slate-500 dark:text-slate-400 hover:underline"
              >
                ← Escolher outro modo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Conectado: dados do número + editar (API oficial) + desconectar */}
      {connected && conn && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1 rounded-xl border border-emerald-200 dark:border-emerald-500/25 bg-emerald-50 dark:bg-emerald-900/15 p-4">
              <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300">
                {conn.profileName || (isBusiness ? 'WhatsApp API oficial (Meta)' : 'WhatsApp conectado')}
              </p>
              <p className="text-sm text-emerald-700 dark:text-emerald-200">
                {isBusiness
                  ? 'Conectado via Cloud API da Meta, sem QR. Envio e recebimento ativos.'
                  : conn.phoneNumber || 'Número conectado e pronto pra uso nos cards dos leads.'}
              </p>
            </div>
            {confirmDisconnect ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => disconnectMut.mutate()}
                  disabled={disconnectMut.isPending}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors disabled:opacity-60"
                >
                  {disconnectMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Unplug size={14} />}
                  Confirmar desconexão
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDisconnect(false)}
                  className="text-xs font-bold text-slate-500 hover:underline"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {isBusiness && (
                  <button
                    type="button"
                    onClick={toggleBizForm}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-sky-200 dark:border-sky-500/30 text-sky-700 dark:text-sky-300 text-xs font-bold hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-colors"
                  >
                    <KeyRound size={14} /> {bizOpen ? 'Fechar edição' : 'Editar conexão'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setConfirmDisconnect(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 text-xs font-bold hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                >
                  <Unplug size={14} /> Desconectar número
                </button>
              </div>
            )}
          </div>

          {/* Edição das credenciais com a conexão ATIVA: o mesmo form; salvar
              recria a instância por baixo sem derrubar as conversas */}
          {isBusiness && bizOpen && bizCredentialsForm}
        </div>
      )}
    </div>
  );
}
