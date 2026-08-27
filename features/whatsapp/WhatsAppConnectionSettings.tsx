'use client';

/**
 * Página Conexão (grupo WhatsApp do menu lateral).
 *
 * Conecta o WhatsApp DESTA organização. MULTI-NÚMERO: a org pode ter VÁRIAS
 * conexões da API oficial (cada número da Meta vira uma conexão; o chat deixa
 * escolher por qual número enviar). QR (Baileys) segue 1 por org. Super admin
 * vê sempre as conexões da organização ATIVA — cada cliente tem as suas.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  MessageCircle,
  QrCode,
  RefreshCw,
  RotateCw,
  Trash2,
  Unplug,
  Users,
} from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';

interface WaConnectionInfo {
  id: string;
  provider: string;
  instanceName: string;
  baseUrl: string | null;
  phoneNumber: string | null;
  profileName: string | null;
  status: 'disconnected' | 'connecting' | 'connected' | string;
  /** Espelho: outro sistema que também recebe os webhooks deste número */
  forwardWebhookUrl?: string | null;
  /** Últimos envios pela conexão: todos falharam = sessão morta (mesmo "conectado") */
  sendHealth?: { failing: boolean; failedCount: number; lastError: string | null; lastAt: string | null } | null;
}

/** Só pra admin (modo API oficial): credenciais salvas, pra edição abrir preenchida.
 *  A chave secreta em si nunca vem pro navegador: só se existe salva e o tamanho. */
interface MetaCreds {
  token: string | null;
  phoneNumberId: string | null;
  wabaId: string | null;
  appId?: string | null;
  appSecretSet?: boolean;
  appSecretLength?: number;
}

type ConnWithCreds = WaConnectionInfo & { metaCredentials?: MetaCreds | null };

interface ConnResponse {
  connected: boolean;
  connection: WaConnectionInfo | null;
  metaCredentials?: MetaCreds | null;
  /** MULTI-NÚMERO: todas as conexões da org (a de cima é a "padrão") */
  connections?: ConnWithCreds[];
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
  const { profile } = useAuth();
  // MULTI-NÚMERO: a confirmação de desconectar é POR conexão (guarda o id)
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);
  // Reiniciar a sessão da instância (Evolution) quando ela diz "conectado" mas os envios falham
  const [restartingId, setRestartingId] = useState<string | null>(null);
  const restartConn = async (id: string) => {
    if (restartingId) return;
    setRestartingId(id);
    try {
      const res = await fetch('/api/whatsapp/connection/restart', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; status?: string };
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      addToast(
        j.status === 'connected'
          ? 'Conexão reiniciada e conectada. Mande uma mensagem de teste para conferir.'
          : `Conexão reiniciada (${j.status || 'aguardando'}). Se não conectar em instantes, desconecte e leia o QR de novo.`,
        j.status === 'connected' ? 'success' : 'error'
      );
      await qc.invalidateQueries({ queryKey: ['waConnection'] });
    } catch (e) {
      addToast((e as Error).message || 'Falha ao reiniciar a conexão', 'error');
    } finally {
      setRestartingId(null);
    }
  };
  // HUB: qual linha QR está sendo PAREADA agora (null = nenhum QR aberto).
  // Substitui o antigo boolean: com várias linhas QR, o painel precisa saber
  // exatamente qual conexão está esperando o scan.
  const [qrTargetId, setQrTargetId] = useState<string | null>(null);

  // GRUPOS DO WHATSAPP: chave da org (padrão desligado); só admin liga/desliga.
  const isAdminRole = profile?.role === 'admin' || profile?.role === 'super_admin';
  const groupsQ = useQuery<{ enabled: boolean }>({
    queryKey: ['waGroupsSetting'],
    queryFn: () => fetchJson<{ enabled: boolean }>('/api/whatsapp/groups'),
    enabled: isAdminRole,
    staleTime: 60_000,
  });
  const groupsMut = useMutation({
    mutationFn: (enabled: boolean) =>
      fetchJson<{ ok: boolean; enabled: boolean }>('/api/whatsapp/groups', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: d => {
      qc.setQueryData(['waGroupsSetting'], { enabled: d.enabled });
      void qc.invalidateQueries({ queryKey: ['waConversations'] });
      addToast(
        d.enabled
          ? 'Grupos ligados. Os grupos aparecem na página Chats conforme chegam mensagens.'
          : 'Grupos desligados. Os grupos saem da página Chats.',
        'success'
      );
    },
    onError: (e: Error) => addToast(e.message || 'Falha ao salvar a configuração de grupos', 'error'),
  });

  const connQ = useQuery<ConnResponse>({
    queryKey: ['waConnection'],
    queryFn: () => fetchJson<ConnResponse>('/api/whatsapp/connection'),
    // aguardando pareamento de um QR: checa rápido; senão devagar
    refetchInterval: () => (qrTargetId ? 4000 : 30000),
    refetchOnWindowFocus: true,
  });

  const conn = connQ.data?.connection ?? null;
  const connected = !!connQ.data?.connected;
  // MULTI-NÚMERO: todas as conexões da org (fallback pro shape antigo)
  const conns: ConnWithCreds[] =
    connQ.data?.connections ??
    (conn ? [{ ...conn, metaCredentials: connQ.data?.metaCredentials ?? null }] : []);
  // Modo API oficial da Meta (Cloud API): sem QR/pareamento
  // "API oficial" cobre os dois backends: via Evolution (evolution_business) e
  // DIRETO na Meta (meta_cloud). A UI trata os dois igual (sem QR, credenciais).
  const isBusinessProvider = (p?: string | null) =>
    ['evolution_business', 'meta_cloud'].includes((p || '').toLowerCase());
  const isBusiness = isBusinessProvider(conn?.provider);
  // HUB: primeira linha QR (Baileys) da org — usada pelo seletor de modo da
  // org sem nada conectado (re-pareamento sem criar linha nova).
  const firstQrConn = conns.find(c => !isBusinessProvider(c.provider)) ?? null;

  // Painel do QR aberto = há uma linha-alvo pareando. Logo após o POST criar
  // a linha, o refetch pode ainda não tê-la trazido: considera "pareando".
  const qrTarget = qrTargetId ? conns.find(c => c.id === qrTargetId) ?? null : null;
  const waitingScan = !!qrTargetId && (qrTarget?.status ?? 'connecting') !== 'connected';

  // Pareou: fecha o painel e avisa (a linha vira mais um cartão do hub)
  React.useEffect(() => {
    if (qrTargetId && qrTarget?.status === 'connected') {
      setQrTargetId(null);
      addToast(`Número ${qrTarget.phoneNumber || ''} conectado via QR!`.replace('  ', ' '), 'success');
    }
  }, [qrTargetId, qrTarget?.status, qrTarget?.phoneNumber]);
  // HUB: o seletor de modo (2 cartões grandes) só existe pra org SEM nenhuma
  // conexão criada; com 1+, a lista de cartões + botões de adicionar assume
  // (linha desconectada tem Reconectar/Editar no próprio cartão).
  const showChooser = !connQ.isLoading && conns.length === 0 && !waitingScan;

  // Form do modo API oficial
  const [bizOpen, setBizOpen] = useState(false);
  const [bizToken, setBizToken] = useState('');
  const [bizNumberId, setBizNumberId] = useState('');
  const [bizWabaId, setBizWabaId] = useState('');
  // Opcionais: com App ID + Chave Secreta o CRM configura o webhook do app
  // sozinho (zero passos no painel da Meta).
  const [bizAppId, setBizAppId] = useState('');
  const [bizAppSecret, setBizAppSecret] = useState('');
  // Chave salva no servidor: o campo abre com bolinhas (1 por caractere) SEM
  // a chave real vir pro navegador. Sentinela intacto = manter a salva.
  const isSecretSentinel = (v: string) => /^•+$/.test(v.trim());

  // ===== Cadastro Embutido da Meta (conexão estilo Kommo) =====
  // O admin clica, loga na Meta, escolhe conta e número; o postMessage do
  // fluxo entrega waba_id/phone_number_id e o FB.login entrega o code — o
  // servidor troca pelo token e monta a conexão inteira sozinho.
  const esQ = useQuery<{ configured: boolean; temAppSalvo?: boolean; faltaSecret?: boolean; appId: string | null; configId: string | null; graphVersion: string }>({
    queryKey: ['waEmbeddedSignupCfg'],
    queryFn: () => fetchJson('/api/whatsapp/embedded-signup'),
    staleTime: 5 * 60_000,
  });
  const [esBusy, setEsBusy] = useState(false);
  // Passo único que a Meta exige no painel dela: colar aqui o Configuration ID
  // (criado 1x em Facebook Login for Business > Configurations). Fica no banco.
  const [esConfigIdDraft, setEsConfigIdDraft] = useState('');
  const [esSecretDraft, setEsSecretDraft] = useState('');
  const [esSavingCfg, setEsSavingCfg] = useState(false);
  const salvarEsConfigId = async () => {
    const v = esConfigIdDraft.trim().replace(/\D/g, '');
    const secret = esSecretDraft.trim();
    if (!v && !secret) return addToast('Cole o Configuration ID e/ou a Chave Secreta.', 'error');
    setEsSavingCfg(true);
    try {
      await fetchJson('/api/whatsapp/embedded-signup', {
        method: 'PATCH',
        body: JSON.stringify({ ...(v ? { configId: v } : {}), ...(secret ? { appSecret: secret } : {}) }),
      });
      setEsConfigIdDraft('');
      setEsSecretDraft('');
      await qc.invalidateQueries({ queryKey: ['waEmbeddedSignupCfg'] });
      addToast('Pronto! A conexão WhatsApp API já está disponível em todas as organizações.', 'success');
    } catch (e) {
      addToast(`Erro ao salvar: ${(e as Error).message}`, 'error');
    } finally {
      setEsSavingCfg(false);
    }
  };
  const esAssets = useRef<{ wabaId?: string; phoneNumberId?: string }>({});

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (!String(e.origin).endsWith('facebook.com')) return;
      try {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
        const d = data?.data ?? {};
        if (d.waba_id) esAssets.current.wabaId = String(d.waba_id);
        if (d.phone_number_id) esAssets.current.phoneNumberId = String(d.phone_number_id);
      } catch {
        /* mensagens de outros widgets da Meta: ignora */
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const carregarSdkFb = (appId: string, version: string) =>
    new Promise<void>((resolve, reject) => {
      const w = window as unknown as { FB?: { init: (o: object) => void } };
      if (w.FB) return resolve();
      const js = document.createElement('script');
      js.src = 'https://connect.facebook.net/pt_BR/sdk.js';
      js.async = true;
      js.onload = () => {
        try {
          (window as unknown as { FB: { init: (o: object) => void } }).FB.init({
            appId,
            autoLogAppEvents: true,
            xfbml: false,
            version,
          });
          resolve();
        } catch (e) {
          reject(e as Error);
        }
      };
      js.onerror = () => reject(new Error('Não foi possível carregar o SDK do Facebook (bloqueador de anúncios?).'));
      document.body.appendChild(js);
    });

  const conectarComFacebook = async () => {
    const cfg = esQ.data;
    if (!cfg?.configured || !cfg.appId || !cfg.configId) return;
    setEsBusy(true);
    esAssets.current = {};
    try {
      await carregarSdkFb(cfg.appId, cfg.graphVersion);
      const FB = (window as unknown as { FB: { login: (cb: (r: unknown) => void, o: object) => void } }).FB;
      FB.login(
        (resp: unknown) => {
          void (async () => {
            try {
              const code = (resp as { authResponse?: { code?: string } })?.authResponse?.code;
              const { wabaId, phoneNumberId } = esAssets.current;
              if (!code) {
                addToast('Conexão cancelada na Meta.', 'warning');
                return;
              }
              if (!wabaId || !phoneNumberId) {
                addToast('A Meta não devolveu a conta/número escolhidos. Tente de novo.', 'error');
                return;
              }
              const r = await fetchJson<{ ok: boolean; numero?: string | null; recebimentoOk?: boolean; avisoWebhook?: string | null }>(
                '/api/whatsapp/embedded-signup',
                { method: 'POST', body: JSON.stringify({ code, wabaId, phoneNumberId }) }
              );
              qc.invalidateQueries({ queryKey: ['waConnection'] });
              addToast(
                `Número ${r.numero || ''} conectado! ${r.recebimentoOk ? 'Envio e recebimento prontos.' : `Atenção: ${r.avisoWebhook || 'recebimento pendente'}`}`.trim(),
                r.recebimentoOk ? 'success' : 'warning'
              );
            } catch (e) {
              addToast(`Erro ao concluir a conexão: ${(e as Error).message}`, 'error');
            } finally {
              setEsBusy(false);
            }
          })();
        },
        {
          config_id: cfg.configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: { setup: {}, sessionInfoVersion: '3' },
        }
      );
    } catch (e) {
      addToast((e as Error).message, 'error');
      setEsBusy(false);
    }
  };

  // Reaplica a assinatura do webhook na Meta usando as credenciais JÁ SALVAS.
  // Serve quando a Meta precisa passar a avisar algo novo — foi o caso do campo
  // que traz as mensagens enviadas pelo celular/WhatsApp Web/outra ferramenta.
  const [resyncingId, setResyncingId] = useState<string | null>(null);
  const resyncMetaWebhook = async (connectionId?: string) => {
    setResyncingId(connectionId ?? 'all');
    try {
      const r = await fetchJson<{
        ok: boolean;
        resultados?: Array<{ phone?: string | null; ok: boolean; erro?: string | null }>;
      }>('/api/whatsapp/connection/resync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(connectionId ? { connectionId } : {}),
      });
      const falhas = (r.resultados ?? []).filter(x => !x.ok);
      if (r.ok && falhas.length === 0) {
        addToast('Webhook reconfigurado. Mensagens enviadas por fora passam a aparecer no chat.', 'success');
      } else if (r.ok) {
        addToast(`Reconfigurado, mas ${falhas.length} número(s) falharam: ${falhas[0]?.erro ?? ''}`, 'warning');
      } else {
        addToast(`Não deu pra reconfigurar: ${falhas[0]?.erro ?? 'erro desconhecido'}`, 'error');
      }
    } catch (e) {
      addToast(`Erro ao reconfigurar: ${(e as Error).message}`, 'error');
    } finally {
      setResyncingId(null);
    }
  };

  // ESPELHO do webhook: o CRM fica com o webhook do provedor (Meta ou
  // Evolution) e repassa os eventos pra outro sistema (n8n, outro CRM,
  // automação) que use o MESMO número.
  const [mirrorOpenId, setMirrorOpenId] = useState<string | null>(null);
  const [mirrorDraft, setMirrorDraft] = useState('');
  const [mirrorSaving, setMirrorSaving] = useState(false);
  const saveMirror = async (connectionId: string, url: string) => {
    setMirrorSaving(true);
    try {
      await fetchJson('/api/whatsapp/connection/forward', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ connectionId, url: url.trim() || null }),
      });
      qc.invalidateQueries({ queryKey: ['waConnection'] });
      addToast(url.trim() ? 'Espelho salvo: o outro sistema passa a receber os eventos deste número.' : 'Espelho desligado.', 'success');
      setMirrorOpenId(null);
    } catch (e) {
      addToast(`Não deu pra salvar o espelho: ${(e as Error).message}`, 'error');
    } finally {
      setMirrorSaving(false);
    }
  };

  // Qual conexão o form da API oficial está EDITANDO (null = número NOVO).
  const [editingConnId, setEditingConnId] = useState<string | null>(null);

  // Abre o form PREENCHIDO com as credenciais da conexão alvo (admin quer
  // ver/conferir o que está salvo) ou VAZIO pra conectar outro número.
  const openBizFormFor = (target: ConnWithCreds | null) => {
    const creds = target?.metaCredentials ?? null;
    setBizToken(creds?.token ?? '');
    setBizNumberId(creds?.phoneNumberId ?? '');
    setBizWabaId(creds?.wabaId ?? '');
    setBizAppId(creds?.appId ?? '');
    setBizAppSecret(creds?.appSecretSet ? '•'.repeat(creds.appSecretLength || 16) : '');
    setEditingConnId(target?.id ?? null);
    setBizOpen(true);
  };
  const closeBizForm = () => {
    setBizOpen(false);
    setEditingConnId(null);
  };
  // Botão do seletor de modo (org sem conexão ativa): abre prefilled com a
  // conexão padrão (reconexão de business desconectada) ou vazio.
  const metaCreds = connQ.data?.metaCredentials ?? null;
  const toggleBizForm = () => {
    if (bizOpen) {
      closeBizForm();
      return;
    }
    const defaultRow = conns.find(c => c.id === conn?.id) ?? null;
    openBizFormFor(defaultRow?.metaCredentials ? defaultRow : metaCreds ? { ...(conn as WaConnectionInfo), metaCredentials: metaCreds } : null);
    setEditingConnId(null);
  };

  const qrQ = useQuery<QrResponse>({
    queryKey: ['waConnectionQr', qrTargetId],
    queryFn: () =>
      fetchJson<QrResponse>(
        `/api/whatsapp/connection/qr${qrTargetId ? `?id=${encodeURIComponent(qrTargetId)}` : ''}`
      ),
    enabled: waitingScan,
    // o QR da Evolution expira (~40s): renova sozinho antes disso
    refetchInterval: waitingScan ? 25000 : false,
  });

  const createMut = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      fetchJson<{
        connection: WaConnectionInfo;
        metaSetup?: {
          displayPhoneNumber?: string;
          idsCorrigidos?: boolean;
          recebimentoOk?: boolean;
          overrideError?: string;
          appWebhookError?: string;
        } | null;
      }>('/api/whatsapp/connection', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: (data, payload) => {
      qc.invalidateQueries({ queryKey: ['waConnection'] });
      qc.invalidateQueries({ queryKey: ['waConnectionQr'] });
      const mode = (payload as { mode?: string }).mode;
      if (mode === 'business' || mode === 'meta_cloud') {
        setBizOpen(false);
        setEditingConnId(null);
        setBizToken('');
        setBizNumberId('');
        setBizWabaId('');
        setBizAppId('');
        setBizAppSecret('');
        setQrTargetId(null);
        const setup = data.metaSetup;
        if (setup?.recebimentoOk) {
          addToast(
            `Conectado (${setup.displayPhoneNumber || 'número validado'})! Envio e recebimento configurados automaticamente.${setup.idsCorrigidos ? ' Os IDs vieram trocados e foram corrigidos.' : ''}`,
            'success'
          );
        } else if (setup) {
          addToast(
            `Conectado (${setup.displayPhoneNumber || 'número validado'}), mas o recebimento automático não concluiu: ${setup.overrideError || setup.appWebhookError || 'informe App ID + Chave Secreta do App e conecte de novo.'}`,
            'error'
          );
        } else {
          addToast('WhatsApp API oficial conectado!', 'success');
        }
      } else {
        // QR: injeta a linha recém-criada DIRETO no cache da lista — assim o
        // painel do QR já nasce dentro do cartão certo, sem "pular" do topo
        // pro lugar enquanto o refetch não chega.
        const created = data.connection;
        if (created?.id) {
          qc.setQueryData<ConnResponse>(['waConnection'], old =>
            old && !(old.connections ?? []).some(x => x.id === created.id)
              ? {
                  ...old,
                  connections: [...(old.connections ?? []), { ...created, metaCredentials: null }],
                }
              : old
          );
        }
        setQrTargetId(created?.id ?? null);
        addToast('Instância criada. Escaneie o QR pra conectar o número.', 'success');
      }
    },
    onError: e => addToast((e as Error).message, 'error'),
  });

  // Entra no fluxo do QR (seletor de modo, org sem nada conectado): reaproveita
  // a linha evolution existente (a rota do QR tem self-healing) ou cria a 1ª.
  const startQrFlow = () => {
    if (firstQrConn) {
      setQrTargetId(firstQrConn.id);
      qc.invalidateQueries({ queryKey: ['waConnectionQr'] });
      return;
    }
    createMut.mutate({ autoCreate: true });
  };

  // HUB: conecta MAIS um número via QR (linha nova, sem mexer nas existentes)
  const addQrNumber = () => {
    createMut.mutate({ autoCreate: true, newNumber: true });
  };

  const disconnectMut = useMutation({
    // MULTI-NÚMERO: desconecta (ou EXCLUI, purge) UMA conexão pelo id
    mutationFn: ({ id, purge }: { id: string; purge?: boolean }) =>
      fetchJson<{ ok: boolean; migrated?: number }>(
        `/api/whatsapp/connection?id=${encodeURIComponent(id)}${purge ? '&purge=true' : ''}`,
        { method: 'DELETE' }
      ),
    onSuccess: (data, vars) => {
      const moved = data?.migrated ?? 0;
      const movedMsg = moved > 0 ? ` ${moved} conversa(s) transferida(s) para a conexão ativa.` : '';
      setConfirmDisconnect(null);
      if (vars.purge && qrTargetId === vars.id) setQrTargetId(null);
      qc.invalidateQueries({ queryKey: ['waConnection'] });
      qc.invalidateQueries({ queryKey: ['waConnectionQr'] });
      addToast((vars.purge ? 'Conexão excluída.' : 'Número desconectado.') + movedMsg, 'success');
    },
    onError: e => {
      setConfirmDisconnect(null);
      addToast((e as Error).message, 'error');
    },
  });

  // Form aberto EDITANDO uma conexão existente (senão é conexão de número novo)
  const isEditingBiz = bizOpen && editingConnId !== null;

  // Form de credenciais da Meta, compartilhado entre o seletor de modo
  // (primeira conexão) e o painel de conectado (edição)
  const bizCredentialsForm = (
    <div className="rounded-2xl border border-sky-200 dark:border-sky-500/25 bg-sky-50/50 dark:bg-sky-900/10 p-5 space-y-3">
      <p className="text-sm font-bold text-slate-900 dark:text-white">
        {isEditingBiz
          ? 'Editar conexão da API oficial'
          : connected
            ? 'Conectar outro número (API oficial)'
            : 'Credenciais da Meta (Cloud API)'}
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">App ID (recomendado)</label>
          <input
            type="text"
            value={bizAppId}
            onChange={e => setBizAppId(e.target.value)}
            placeholder="ID do app no painel da Meta"
            className="w-full bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-sky-500 font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Chave Secreta do App (recomendado)</label>
          <input
            type="password"
            value={bizAppSecret}
            onChange={e => setBizAppSecret(e.target.value)}
            placeholder="Configurações do app, Básico"
            className="w-full bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-sky-500 font-mono"
          />
          <p className="text-[10px] text-slate-400 mt-1">
            Com App ID + Chave Secreta, o CRM configura o webhook e liga o recebimento sozinho
            (nada manual no painel da Meta). Ficam salvos na conexão e aparecem na edição.
          </p>
        </div>
      </div>

      <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-1 border-t border-sky-200/60 dark:border-sky-500/20 pt-3">
        <p>
          ⚠️ <span className="font-semibold">Janela de 24h:</span> pela regra da Meta, fora de 24h
          após a última mensagem do cliente só é possível enviar templates aprovados.
          Mensagens livres são recusadas (o CRM mostra a falha no chat).
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() =>
            createMut.mutate({
              // Modo DIRETO na Meta (sem Evolution). Envio/recebimento falam
              // direto com a Cloud API; o setup do webhook é AUTOMÁTICO.
              mode: 'meta_cloud',
              // edição aponta a linha exata (trocar o Phone Number ID atualiza
              // a MESMA conexão em vez de criar uma segunda)
              editingConnectionId: editingConnId || undefined,
              metaToken: bizToken.trim(),
              metaNumberId: bizNumberId.trim(),
              metaBusinessId: bizWabaId.trim() || undefined,
              metaAppId: bizAppId.trim() || undefined,
              // sentinela intacto = não reenviar (o servidor mantém a chave salva)
              metaAppSecret:
                bizAppSecret.trim() && !isSecretSentinel(bizAppSecret)
                  ? bizAppSecret.trim()
                  : undefined,
            })
          }
          disabled={createMut.isPending || !bizToken.trim() || !bizNumberId.trim()}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {createMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
          {isEditingBiz ? 'Salvar novas credenciais' : 'Conectar API oficial'}
        </button>
        <button
          type="button"
          onClick={closeBizForm}
          className="text-sm font-bold text-slate-500 dark:text-slate-400 hover:underline"
        >
          Cancelar
        </button>
      </div>
    </div>
  );

  // Painel do QR ao vivo — renderiza DENTRO do cartão da conexão que está
  // pareando (ou num cartão avulso enquanto a linha recém-criada não chega
  // no refetch da lista).
  const qrPanel = (
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
            <span className="text-xs">
              {qrQ.isError ? 'Falha ao gerar o QR. Tentando de novo…' : 'Gerando QR…'}
            </span>
          </div>
        )}
      </div>
      <div className="text-sm text-slate-600 dark:text-slate-300 space-y-2">
        <p className="font-bold text-slate-900 dark:text-white">Conecte o número neste cartão:</p>
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
          O QR se renova sozinho a cada 25s. Assim que o número parear, o cartão vira
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
            onClick={() => setQrTargetId(null)}
            className="text-xs font-bold text-slate-500 dark:text-slate-400 hover:underline"
          >
            ← Fechar o QR
          </button>
        </div>
      </div>
    </div>
  );

  // Bloco de ativação do Cadastro Embutido (super_admin): renderiza tanto no
  // seletor de modos (org sem conexão) quanto no HUB (org com conexões).
  const esAtivacaoBloco = (
    <>
      {!esQ.data?.configured && (esQ.data?.temAppSalvo || esQ.data?.faltaSecret) && profile?.role === 'super_admin' && (
                <div className="mb-2 rounded-xl border border-dashed border-sky-300 dark:border-sky-500/40 p-3 text-left">
                  <p className="text-[11px] font-bold text-sky-700 dark:text-sky-300 mb-1.5">
                    Ativar conexão com o Facebook (1 passo)
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2 leading-relaxed">
                    No painel da Meta, crie uma Configuration do modelo WhatsApp Embedded Signup em{' '}
                    <a
                      className="underline font-semibold"
                      href={`https://developers.facebook.com/apps/${esQ.data?.appId ?? ''}/fb-login-for-business/configurations/`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Facebook Login for Business, Configurations
                    </a>{' '}
                    e cole o ID dela aqui:
                  </p>
                  <div className="flex flex-col gap-2">
                    {!esQ.data?.configId && (
                      <input
                        type="text"
                        value={esConfigIdDraft}
                        onChange={e => setEsConfigIdDraft(e.target.value)}
                        placeholder="Configuration ID"
                        className="w-full bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                      />
                    )}
                    {esQ.data?.faltaSecret && (
                      <input
                        type="password"
                        value={esSecretDraft}
                        onChange={e => setEsSecretDraft(e.target.value)}
                        placeholder="Chave Secreta do app (Configurações > Básico > Mostrar)"
                        className="w-full bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => void salvarEsConfigId()}
                      disabled={esSavingCfg}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white transition-colors disabled:opacity-60"
                    >
                      {esSavingCfg ? 'Salvando...' : 'Ativar'}
                    </button>
                  </div>
                </div>
              )}
    </>
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
            <CheckCircle2 size={13} /> Conectado
            {conns.filter(c => c.status === 'connected').length > 1
              ? ` · ${conns.filter(c => c.status === 'connected').length} números`
              : isBusiness
                ? ' · API oficial'
                : ''}
          </span>
        )}
        {/* o "Aguardando QR" agora vive no selo do próprio cartão do número */}
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

      {/* Seletor de modo (org sem NENHUMA conexão): QR Code ou API oficial */}
      {showChooser && (
        <div className="space-y-4">
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
              {esAtivacaoBloco}
              {esQ.data?.configured && (
                <button
                  type="button"
                  onClick={() => void conectarComFacebook()}
                  disabled={esBusy}
                  className="mt-auto mb-2 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold shadow-lg shadow-sky-600/20 transition-colors disabled:opacity-60"
                >
                  {esBusy ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
                  Conectar WhatsApp API
                </button>
              )}
              {/* Caminho manual (token/IDs) mantido ENQUANTO o fluxo novo amadurece */}
              <button
                type="button"
                onClick={toggleBizForm}
                className={`${esQ.data?.configured ? '' : 'mt-auto '}inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-sky-300 dark:border-sky-500/40 text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-900/20 text-sm font-bold transition-colors`}
              >
                <KeyRound size={16} />
                {bizOpen ? 'Fechar configuração' : esQ.data?.configured ? 'Configurar manualmente' : 'Configurar API oficial'}
              </button>
            </div>
          </div>

          {/* Form de credenciais da Meta */}
          {bizOpen && bizCredentialsForm}
        </div>
      )}

      {/* HUB: um CARTÃO por número; QR de pareamento e edição de credenciais
          abrem DENTRO do cartão do próprio número */}
      {conns.length > 0 && (
        <div className="space-y-4">
          <div className="space-y-3">
            {conns.map(c => {
              const rowBiz = isBusinessProvider(c.provider);
              // Só meta_cloud é editável pelo form (o legado evolution_business
              // guarda o apikey da Evolution como token — prefill seria errado
              // e salvar converteria o modo por baixo dos panos)
              const rowEditable = (c.provider || '').toLowerCase() === 'meta_cloud';
              const rowOn = c.status === 'connected';
              // ID da conexão: sempre para meta_cloud; para QR (evolution) e
              // evolution_business só quando conectada. O espelho do webhook
              // aparece para qualquer provedor conectado: meta_cloud repassa
              // assinado com o app secret (whatsapp-webhook-meta); evolution e
              // evolution_business repassam com X-Webhook-Secret, X-Connection-Id
              // e X-Evolution-Event (whatsapp-webhook).
              const rowIdVisible = rowEditable || rowOn;
              const rowMirrorVisible = rowOn;
              const rowPairing = qrTargetId === c.id && !rowOn;
              const rowEditing = bizOpen && editingConnId === c.id;
              return (
                <div
                  key={c.id}
                  className="rounded-2xl border border-slate-200 dark:border-white/10 overflow-hidden"
                >
                  <div className="p-4">
                    {/* Linha 1: identidade do número (nome, status, telefone) com espaço próprio */}
                    <div className="flex items-center gap-3">
                    <span
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        rowBiz
                          ? 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-400'
                          : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400'
                      }`}
                    >
                      {rowBiz ? <KeyRound size={18} /> : <QrCode size={18} />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                          {c.profileName || (rowBiz ? 'WhatsApp API oficial' : 'WhatsApp via QR Code')}
                        </p>
                        {rowOn && c.sendHealth?.failing ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300">
                            <AlertTriangle size={11} /> Falha de envio
                          </span>
                        ) : rowOn ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                            <CheckCircle2 size={11} /> Conectado
                          </span>
                        ) : rowPairing ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300">
                            <Loader2 size={11} className="animate-spin" /> Aguardando QR
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400">
                            <Unplug size={11} /> Desconectado
                          </span>
                        )}
                      </div>
                      {rowOn && c.sendHealth?.failing ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-900/15 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                          <AlertTriangle size={14} className="shrink-0" />
                          <span className="flex-1 min-w-[12rem]">
                            Os últimos {c.sendHealth.failedCount} envios falharam
                            {c.sendHealth.lastError ? ` (${c.sendHealth.lastError})` : ''}. O provedor diz "conectado", mas a
                            sessão do WhatsApp pode ter caído: reinicie a conexão; se continuar, desconecte e leia o QR de novo.
                          </span>
                          {!rowBiz ? (
                            <button
                              type="button"
                              onClick={() => void restartConn(c.id)}
                              disabled={restartingId === c.id}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-500/40 bg-white dark:bg-black/20 text-red-700 dark:text-red-300 font-bold hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors disabled:opacity-60"
                            >
                              {restartingId === c.id ? <Loader2 size={13} className="animate-spin" /> : <RotateCw size={13} />}
                              Reiniciar conexão
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {c.phoneNumber ||
                          (rowBiz ? 'Número da Meta (Cloud API)' : 'Número pareado pelo celular')}
                        {' · '}
                        {rowBiz ? 'API oficial da Meta' : 'QR Code'}
                      </p>
                    </div>
                    </div>
                    {/* Linha 2: barra de ações, separada da identidade para nada ficar espremido */}
                    {confirmDisconnect === c.id ? (
                      <div className="flex items-center gap-2 flex-wrap mt-3 pt-3 border-t border-slate-100 dark:border-white/10">
                        <button
                          type="button"
                          onClick={() => disconnectMut.mutate({ id: c.id, purge: !rowOn })}
                          disabled={disconnectMut.isPending}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors disabled:opacity-60"
                        >
                          {disconnectMut.isPending ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : rowOn ? (
                            <Unplug size={14} />
                          ) : (
                            <Trash2 size={14} />
                          )}
                          {rowOn ? 'Confirmar desconexão' : 'Confirmar exclusão'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDisconnect(null)}
                          className="text-xs font-bold text-slate-500 hover:underline"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap mt-3 pt-3 border-t border-slate-100 dark:border-white/10">
                        {!rowBiz && !rowOn && !rowPairing && (
                          <button
                            type="button"
                            onClick={() => {
                              setQrTargetId(c.id);
                              qc.invalidateQueries({ queryKey: ['waConnectionQr'] });
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs font-bold hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
                          >
                            <QrCode size={14} /> Reconectar (QR)
                          </button>
                        )}
                        {rowEditable && rowOn && (
                          <button
                            type="button"
                            onClick={() => void resyncMetaWebhook(c.id)}
                            disabled={resyncingId !== null}
                            title="Reconfigura o webhook deste número na Meta — use se as mensagens enviadas pelo celular ou por outra plataforma (ex.: Kommo) não estiverem aparecendo no chat"
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-sky-200 dark:border-sky-500/30 text-sky-700 dark:text-sky-300 text-xs font-bold hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-colors disabled:opacity-60"
                          >
                            {resyncingId === c.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <RefreshCw size={14} />
                            )}
                            Reconfigurar webhook
                          </button>
                        )}
                        {rowIdVisible && (
                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard.writeText(c.id).then(
                                () => addToast('Connection ID copiado. É o connection_id do n8n/agente de IA.', 'success'),
                                () => addToast(`Connection ID: ${c.id}`, 'info')
                              );
                            }}
                            title={
                              rowEditable
                                ? `ID desta conexão para integrações (n8n, agente de IA). Clique pra copiar: ${c.id}`
                                : `ID desta conexão para integrações (n8n, agente de IA). Para receber em outro sistema as mensagens já tratadas pelo CRM, use Configurações > Integrações > Webhooks (Follow-up), eventos whatsapp.message.received e whatsapp.message.sent, e filtre por connection.id. Clique pra copiar: ${c.id}`
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 text-xs font-bold hover:bg-slate-50 dark:hover:bg-white/10 transition-colors"
                          >
                            <Copy size={14} /> ID da conexão <span className="font-mono font-normal">{c.id.slice(0, 8)}…</span>
                          </button>
                        )}
                        {rowMirrorVisible && (
                          <button
                            type="button"
                            onClick={() => {
                              if (mirrorOpenId === c.id) {
                                setMirrorOpenId(null);
                              } else {
                                setMirrorDraft(c.forwardWebhookUrl ?? '');
                                setMirrorOpenId(c.id);
                              }
                            }}
                            title={
                              rowEditable
                                ? 'Outro sistema usa este mesmo número? Cole a URL do webhook dele aqui: o CRM recebe da Meta e repassa tudo pra lá, e os dois funcionam ao mesmo tempo'
                                : 'Outro sistema (n8n, outro CRM) usa este mesmo número? Cole a URL do webhook dele aqui: o CRM recebe da Evolution e repassa o payload bruto pra lá, e os dois funcionam ao mesmo tempo'
                            }
                            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold transition-colors ${
                              c.forwardWebhookUrl
                                ? 'border-violet-300 dark:border-violet-500/40 bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300'
                                : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/10'
                            }`}
                          >
                            <Copy size={14} />
                            {c.forwardWebhookUrl ? 'Espelho ligado' : 'Espelhar webhook'}
                          </button>
                        )}
                        {rowMirrorVisible && mirrorOpenId === c.id && (
                          <div className="basis-full mt-2 p-3 rounded-xl border border-violet-200 dark:border-violet-500/30 bg-violet-50/60 dark:bg-violet-900/10">
                            {rowEditable ? (
                              <>
                                <p className="text-xs text-slate-600 dark:text-slate-300 mb-2">
                                  A Meta entrega os eventos de um número para <b>um</b> destino. Se outro sistema for usar este número
                                  (outro CRM, automação), não configure o webhook lá: cole aqui a URL do webhook dele. O CRM recebe da
                                  Meta e repassa o payload original (assinado com o app secret) para essa URL.
                                </p>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
                                  Cabeçalhos enviados no repasse: <span className="font-mono">content-type: application/json</span>,{' '}
                                  <span className="font-mono">user-agent: NossoCRM-Webhook-Mirror/1.0</span> e{' '}
                                  <span className="font-mono">x-hub-signature-256</span> (HMAC SHA-256 do corpo com a Chave Secreta do
                                  App, igual ao que a Meta envia, quando ela estiver salva na conexão). Os pings de verificação do
                                  próprio CRM não são repassados.
                                </p>
                              </>
                            ) : (
                              <>
                                <p className="text-xs text-slate-600 dark:text-slate-300 mb-2">
                                  A Evolution entrega os eventos deste número para <b>um</b> destino. Se outro sistema for usar este
                                  número (n8n, outro CRM, automação), não configure o webhook lá: cole aqui a URL do webhook dele. O
                                  CRM recebe da Evolution e repassa o payload bruto para essa URL, com os headers{' '}
                                  <span className="font-mono">X-Webhook-Secret</span> (segredo desta conexão),{' '}
                                  <span className="font-mono">X-Connection-Id</span> e{' '}
                                  <span className="font-mono">X-Evolution-Event</span>.
                                </p>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
                                  Cabeçalhos enviados no repasse: <span className="font-mono">content-type: application/json</span>,{' '}
                                  <span className="font-mono">user-agent: NossoCRM-Webhook-Mirror/1.0</span>,{' '}
                                  <span className="font-mono">X-Webhook-Secret</span> (o segredo do webhook desta conexão, o mesmo
                                  que fecha a URL do webhook cadastrada na Evolution, para o outro sistema conferir a origem),{' '}
                                  <span className="font-mono">X-Connection-Id</span> (o ID da conexão acima, use para filtrar no n8n)
                                  e <span className="font-mono">X-Evolution-Event</span> (o evento da Evolution, ex.:{' '}
                                  <span className="font-mono">messages.upsert</span>). O corpo é o JSON original da Evolution. O
                                  repasse roda em segundo plano e nunca atrasa nem altera o que o CRM grava; corpos sem evento não
                                  são repassados.
                                </p>
                              </>
                            )}
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
                              Dica: para receber só as mensagens já tratadas pelo CRM (sem o payload bruto do provedor), use
                              Configurações &gt; Integrações &gt; Webhooks (Follow-up), marque os eventos{' '}
                              <span className="font-mono">whatsapp.message.received</span> e{' '}
                              <span className="font-mono">whatsapp.message.sent</span> e filtre pelo ID da conexão (campo{' '}
                              <span className="font-mono">connection.id</span> do payload).
                            </p>
                            <div className="flex items-center gap-2 flex-wrap">
                              <input
                                type="url"
                                value={mirrorDraft}
                                onChange={e => setMirrorDraft(e.target.value)}
                                placeholder="https://outro-sistema.com/webhook/whatsapp"
                                className="flex-1 min-w-[240px] bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-violet-500 font-mono"
                              />
                              <button
                                type="button"
                                onClick={() => void saveMirror(c.id, mirrorDraft)}
                                disabled={mirrorSaving}
                                className="px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold disabled:opacity-60"
                              >
                                {mirrorSaving ? 'Salvando...' : 'Salvar'}
                              </button>
                              {c.forwardWebhookUrl && (
                                <button
                                  type="button"
                                  onClick={() => void saveMirror(c.id, '')}
                                  disabled={mirrorSaving}
                                  className="px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-white/10 disabled:opacity-60"
                                >
                                  Desligar espelho
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                        {rowEditable && (
                          <button
                            type="button"
                            onClick={() => (rowEditing ? closeBizForm() : openBizFormFor(c))}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-sky-200 dark:border-sky-500/30 text-sky-700 dark:text-sky-300 text-xs font-bold hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-colors"
                          >
                            <KeyRound size={14} />
                            {rowEditing ? 'Fechar edição' : 'Editar conexão'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setConfirmDisconnect(c.id)}
                          className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 text-xs font-bold hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                        >
                          {rowOn ? (
                            <>
                              <Unplug size={14} /> Desconectar
                            </>
                          ) : (
                            <>
                              <Trash2 size={14} /> Excluir
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                  {/* QR de pareamento DESTE número, dentro do cartão dele */}
                  {rowPairing && (
                    <div className="border-t border-slate-200 dark:border-white/10 bg-slate-50/60 dark:bg-black/10 p-4">
                      {qrPanel}
                    </div>
                  )}
                  {/* Edição das credenciais DESTE número, dentro do cartão dele */}
                  {rowEditing && (
                    <div className="border-t border-slate-200 dark:border-white/10 bg-sky-50/40 dark:bg-sky-900/10 p-4">
                      {bizCredentialsForm}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Fallback raríssimo: pareando uma linha que não está na lista
              (o cache otimista normalmente já a injetou no cartão acima) */}
          {waitingScan && !qrTarget && (
            <div className="rounded-2xl border border-emerald-200 dark:border-emerald-500/25 p-4">
              {qrPanel}
            </div>
          )}

          {/* HUB: adicionar mais números, de QUALQUER tipo — QR e API oficial
              convivem em qualquer quantidade. Os botões ficam SEMPRE visíveis:
              com o form da API aberto, o dela vira "Fechar" e o do QR fecha o
              form antes de abrir o QR (dá pra trocar de ideia a qualquer hora). */}
          {esAtivacaoBloco}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                closeBizForm();
                addQrNumber();
              }}
              disabled={createMut.isPending}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-emerald-300 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-sm font-bold transition-colors disabled:opacity-60"
            >
              {createMut.isPending ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <QrCode size={15} />
              )}
              Conectar número via QR Code
            </button>
            {esQ.data?.configured && (
              <button
                type="button"
                onClick={() => void conectarComFacebook()}
                disabled={esBusy}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold shadow-lg shadow-sky-600/20 transition-colors disabled:opacity-60"
              >
                {esBusy ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
                Conectar WhatsApp API
              </button>
            )}
            {/* Caminho manual (token/IDs) mantido ENQUANTO o fluxo novo amadurece */}
            <button
              type="button"
              onClick={() =>
                bizOpen && editingConnId === null ? closeBizForm() : openBizFormFor(null)
              }
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-sky-300 dark:border-sky-500/40 text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-900/20 text-sm font-bold transition-colors"
            >
              <KeyRound size={15} />
              {bizOpen && editingConnId === null
                ? 'Fechar formulário'
                : 'Conectar número API oficial (manual)'}
            </button>
          </div>

          {/* Form de NÚMERO NOVO (a edição renderiza dentro do cartão da linha) */}
          {bizOpen && editingConnId === null && bizCredentialsForm}
        </div>
      )}

      {/* GRUPOS DO WHATSAPP: opcional por organização (nem toda org usa);
          só admin liga/desliga. Só números via QR Code têm grupos. */}
      {isAdminRole && (
        <div className="mt-6 rounded-2xl border border-slate-200 dark:border-white/10 p-5">
          <div className="flex items-start gap-3">
            <span className="w-9 h-9 shrink-0 rounded-xl bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 flex items-center justify-center">
              <Users size={18} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-bold text-slate-900 dark:text-white">Grupos do WhatsApp no chat</p>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!groupsQ.data?.enabled}
                  disabled={groupsQ.isLoading || groupsMut.isPending}
                  onClick={() => groupsMut.mutate(!groupsQ.data?.enabled)}
                  title={groupsQ.data?.enabled ? 'Desligar grupos' : 'Ligar grupos'}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
                    groupsQ.data?.enabled ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-white/20'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      groupsQ.data?.enabled ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mt-1">
                Desligado por padrão: mensagens de grupo são ignoradas. Ligado, os grupos aparecem na página
                Chats (filtro "Grupos") para ler e responder por aqui, com o nome de quem escreveu em cada
                mensagem. Só grupos com mensagem nova depois de ligar aparecem; o histórico anterior não é
                importado.
              </p>
              <div className="mt-2 space-y-1.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                <p>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">Número via QR Code:</span>{' '}
                  funciona com os grupos comuns do WhatsApp. Qualquer grupo em que o número esteja (ou em que o
                  cliente coloque o número) chega aqui, sem limite de tamanho.
                </p>
                <p>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">Número da WhatsApp API oficial (Meta):</span>{' '}
                  não entra em grupos comuns. A Meta só oferece um formato próprio, a Groups API: o grupo é criado
                  pela empresa, as pessoas entram por link de convite, no máximo 8 participantes, exige Conta
                  Comercial Oficial (selo) e cobra por mensagem. Esse formato ainda não está disponível no CRM.
                </p>
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1.5">
                Agentes de IA e robôs nunca respondem em grupo.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
