'use client';

/**
 * Configurações → Integrações → WhatsApp.
 *
 * Conecta o WhatsApp DESTA organização (1 número por org): o admin clica em
 * "Conectar", o servidor cria a instância da org na Evolution e a tela mostra
 * o QR ao vivo (auto-renovado) até o número ser pareado. Super admin vê sempre
 * a conexão da organização ATIVA — cada cliente tem a sua.
 */
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, MessageCircle, QrCode, Unplug } from 'lucide-react';
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
  const waitingScan = !!conn && !connected;

  const qrQ = useQuery<QrResponse>({
    queryKey: ['waConnectionQr'],
    queryFn: () => fetchJson<QrResponse>('/api/whatsapp/connection/qr'),
    enabled: waitingScan,
    // o QR da Evolution expira (~40s): renova sozinho antes disso
    refetchInterval: waitingScan ? 25000 : false,
  });

  const createMut = useMutation({
    mutationFn: () =>
      fetchJson<{ connection: WaConnectionInfo }>('/api/whatsapp/connection', {
        method: 'POST',
        body: JSON.stringify({ autoCreate: true }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['waConnection'] });
      qc.invalidateQueries({ queryKey: ['waConnectionQr'] });
      addToast('Instância criada. Escaneie o QR pra conectar o número.', 'success');
    },
    onError: e => addToast((e as Error).message, 'error'),
  });

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

  return (
    <div className="bg-white dark:bg-dark-card rounded-2xl border border-slate-200 dark:border-white/10 p-6">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
          <MessageCircle size={16} />
        </span>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">WhatsApp</h2>
        {connected && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 size={13} /> Conectado
          </span>
        )}
        {waitingScan && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300">
            <Loader2 size={13} className="animate-spin" /> Aguardando conexão
          </span>
        )}
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
        Conecte o <span className="font-semibold">WhatsApp do seu escritório</span> pra atender seus
        leads direto pelo CRM. As conversas aparecem na página Chats e na aba WhatsApp dentro do
        card de cada lead.
      </p>

      {connQ.isLoading && (
        <div className="flex items-center gap-2 text-slate-400 py-8 justify-center">
          <Loader2 className="animate-spin" size={18} /> Carregando…
        </div>
      )}

      {/* Sem conexão ainda: um clique cria a instância da org */}
      {!connQ.isLoading && !conn && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <QrCode size={40} className="text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-600 dark:text-slate-300 max-w-md">
            Seu WhatsApp ainda não está conectado. Clique abaixo pra gerar o QR Code e conectar o
            número do escritório.
          </p>
          <button
            type="button"
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold transition-colors disabled:opacity-60"
          >
            {createMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <MessageCircle size={16} />}
            Conectar WhatsApp
          </button>
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
                <span className="text-xs">{qrQ.isError ? 'Falha ao gerar o QR — tentando de novo…' : 'Gerando QR…'}</span>
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
            <button
              type="button"
              onClick={() => qrQ.refetch()}
              className="text-xs font-bold text-primary-600 dark:text-primary-400 hover:underline"
            >
              Gerar novo QR agora
            </button>
          </div>
        </div>
      )}

      {/* Conectado: dados do número + desconectar */}
      {connected && conn && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1 rounded-xl border border-emerald-200 dark:border-emerald-500/25 bg-emerald-50 dark:bg-emerald-900/15 p-4">
            <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300">
              {conn.profileName || 'WhatsApp conectado'}
            </p>
            <p className="text-sm text-emerald-700 dark:text-emerald-200">
              {conn.phoneNumber || 'Número conectado e pronto pra uso nos cards dos leads.'}
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
            <button
              type="button"
              onClick={() => setConfirmDisconnect(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 text-xs font-bold hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            >
              <Unplug size={14} /> Desconectar número
            </button>
          )}
        </div>
      )}
    </div>
  );
}
