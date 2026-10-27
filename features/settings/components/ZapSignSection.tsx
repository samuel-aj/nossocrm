'use client';

/**
 * Configurações > Integrações > ZapSign: conecta a conta ZapSign do escritório
 * (token da API), testa listando os modelos e cadastra o webhook de retorno.
 * O token nunca volta inteiro do servidor.
 */
import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ExternalLink, FileSignature, Loader2, RefreshCw, Unplug } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import ConfirmModal from '@/components/ConfirmModal';
import { SETTINGS_BTN_PRIMARY, SETTINGS_BTN_SECONDARY, SETTINGS_INPUT_CLASS, SettingsCard, SettingsRow } from './SettingsUi';

type Status = {
  connected: boolean;
  sandbox?: boolean;
  token_hint?: string;
  template_count?: number | null;
  verified_at?: string | null;
  webhook_ok?: boolean;
  webhook_url?: string | null;
  last_error?: string | null;
};

type Template = { token: string; name: string; lang: string | null; folder_path: string | null };

export const ZAPSIGN_STATUS_KEY = ['zapsign', 'settings'] as const;

export function useZapSignStatus() {
  return useQuery<Status>({
    queryKey: ZAPSIGN_STATUS_KEY,
    queryFn: async () => {
      const res = await fetch('/api/integrations/zapsign/settings', { credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      return body as Status;
    },
    staleTime: 30_000,
    retry: false,
  });
}

export const ZapSignSection: React.FC = () => {
  const { addToast } = useToast();
  const qc = useQueryClient();
  const status = useZapSignStatus();
  const [token, setToken] = useState('');
  const [sandbox, setSandbox] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const connected = !!status.data?.connected;

  useEffect(() => {
    if (status.data) setSandbox(!!status.data.sandbox);
  }, [status.data]);

  const templates = useQuery<{ templates: Template[] }>({
    queryKey: ['zapsign', 'templates'],
    enabled: connected,
    queryFn: async () => {
      const res = await fetch('/api/integrations/zapsign/templates', { credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      return body as { templates: Template[] };
    },
    staleTime: 60_000,
    retry: false,
  });

  const connect = async () => {
    if (!token.trim()) {
      addToast('Cole o token da API da ZapSign.', 'warning');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/integrations/zapsign/settings', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ api_token: token.trim(), sandbox }),
      });
      const body = (await res.json().catch(() => ({}))) as Status & { error?: string };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setToken('');
      qc.setQueryData(ZAPSIGN_STATUS_KEY, body);
      await qc.invalidateQueries({ queryKey: ['zapsign'] });
      addToast(body.webhook_ok ? 'ZapSign conectada.' : 'ZapSign conectada, mas o webhook de retorno não foi cadastrado. Veja o aviso.', body.webhook_ok ? 'success' : 'warning');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Falha ao conectar', 'error');
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    setConfirmDisconnect(false);
    setSaving(true);
    try {
      const res = await fetch('/api/integrations/zapsign/settings', { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await qc.invalidateQueries({ queryKey: ['zapsign'] });
      addToast('ZapSign desconectada. Os envios automáticos por etapa param de funcionar.', 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Falha ao desconectar', 'error');
    } finally {
      setSaving(false);
    }
  };

  const s = status.data;

  return (
    <div className="space-y-6">
      <SettingsCard
        title="ZapSign"
        icon={FileSignature}
        description="Contratos e procurações assinados pelo celular do cliente, enviados pelo CRM com os dados do lead já preenchidos."
        right={
          connected ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 size={13} aria-hidden="true" /> Conectada{s?.sandbox ? ' (sandbox)' : ''}
            </span>
          ) : null
        }
      >
        {status.isLoading ? (
          <p className="inline-flex items-center gap-2 text-sm text-slate-500">
            <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Carregando...
          </p>
        ) : status.error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{(status.error as Error).message}</p>
        ) : (
          <>
            {connected && s ? (
              <div className="space-y-0">
                <SettingsRow title="Conta" description={`Token ${s.token_hint ?? ''}${s.sandbox ? ' no ambiente de testes (sandbox, sem validade jurídica)' : ' em produção'}`} control={
                  <button type="button" onClick={() => setConfirmDisconnect(true)} disabled={saving} className={SETTINGS_BTN_SECONDARY}>
                    <Unplug size={14} aria-hidden="true" /> Desconectar
                  </button>
                } />
                <SettingsRow
                  title="Retorno da assinatura (webhook)"
                  description={
                    s.webhook_ok
                      ? 'Cadastrado na ZapSign. Quando o cliente assina ou recusa, o CRM fica sabendo na hora.'
                      : 'Não cadastrado. O CRM não vai saber quando o cliente assinar. Conecte de novo com o token para tentar outra vez.'
                  }
                  control={
                    s.webhook_ok ? (
                      <CheckCircle2 size={18} className="text-emerald-500" aria-label="Webhook cadastrado" />
                    ) : (
                      <AlertTriangle size={18} className="text-amber-500" aria-label="Webhook não cadastrado" />
                    )
                  }
                >
                  {s.last_error ? <p className="text-xs text-amber-700 dark:text-amber-300">{s.last_error}</p> : null}
                </SettingsRow>
                <SettingsRow
                  title="Modelos da conta"
                  description="Modelos em Word com variáveis entre chaves, por exemplo {{NOME}} e {{VALOR}}. O CRM preenche sozinho com os dados do lead."
                  control={
                    <button type="button" onClick={() => void templates.refetch()} disabled={templates.isFetching} className={SETTINGS_BTN_SECONDARY}>
                      <RefreshCw size={14} className={templates.isFetching ? 'animate-spin' : ''} aria-hidden="true" /> Atualizar
                    </button>
                  }
                >
                  {templates.isLoading ? (
                    <p className="text-xs text-slate-500">Carregando modelos...</p>
                  ) : templates.error ? (
                    <p className="text-xs text-red-600 dark:text-red-400">{(templates.error as Error).message}</p>
                  ) : (templates.data?.templates.length ?? 0) === 0 ? (
                    <p className="text-xs text-slate-500">
                      Nenhum modelo DOCX na conta. Crie um em{' '}
                      <a className="underline" href={s.sandbox ? 'https://sandbox.app.zapsign.com.br/conta/modelos' : 'https://app.zapsign.com.br/conta/modelos'} target="_blank" rel="noreferrer">
                        Modelos da ZapSign
                      </a>
                      .
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100 dark:divide-white/5 rounded-lg border border-slate-200 dark:border-white/10">
                      {templates.data?.templates.map((t) => (
                        <li key={t.token} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          <span className="min-w-0 truncate text-slate-800 dark:text-slate-100">{t.name}</span>
                          <span className="shrink-0 text-[11px] text-slate-400 font-mono">{t.token.slice(0, 8)}…</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </SettingsRow>
              </div>
            ) : (
              <div className="space-y-4">
                <ol className="list-decimal pl-5 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                  <li>
                    Na ZapSign, abra <strong>Configurações &gt; Integrações &gt; API ZapSign</strong> e copie o <strong>Token de Acesso</strong> (precisa de um plano com API).
                  </li>
                  <li>Cole o token abaixo e clique em Conectar. O CRM testa o token e cadastra o retorno da assinatura.</li>
                  <li>Depois, em cada etapa do funil (Automatizar), escolha o modelo que vai para assinatura.</li>
                </ol>
                <div>
                  <label htmlFor="zapsign-token" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Token da API
                  </label>
                  <input
                    id="zapsign-token"
                    type="password"
                    autoComplete="off"
                    className={SETTINGS_INPUT_CLASS}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Cole aqui o token de acesso da ZapSign"
                  />
                </div>
                <label className="inline-flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <input type="checkbox" className="h-4 w-4 accent-primary-600" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} />
                  Ambiente de testes (sandbox). Documentos sem validade jurídica, para experimentar sem gastar a franquia.
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" onClick={() => void connect()} disabled={saving || !token.trim()} className={SETTINGS_BTN_PRIMARY}>
                    {saving ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <FileSignature size={14} aria-hidden="true" />} Conectar
                  </button>
                  <a className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-primary-600 underline" href="https://docs.zapsign.com.br/" target="_blank" rel="noreferrer">
                    Documentação da ZapSign <ExternalLink size={11} aria-hidden="true" />
                  </a>
                </div>
              </div>
            )}
          </>
        )}
      </SettingsCard>

      <SettingsCard title="Como funciona" description="O que acontece do envio até o contrato assinado.">
        <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600 dark:text-slate-300">
          <li>Na etapa do funil (modo Automatizar, bloco "Assinatura") você escolhe o modelo e liga cada variável a um dado do lead.</li>
          <li>Quando o lead entra na etapa, o CRM cria o documento na ZapSign e manda o link pelo WhatsApp do CRM (sem custo) ou pela ZapSign.</li>
          <li>Também dá para enviar na mão, pela tela do lead, conferindo os valores antes.</li>
          <li>Quando o cliente assina, o PDF entra nos anexos do lead, o histórico registra, e o lead pode mudar de etapa, ganhar etiqueta ou iniciar um robô.</li>
          <li>Cada documento criado conta na franquia do plano da ZapSign, mesmo que não seja assinado.</li>
        </ul>
      </SettingsCard>

      <ConfirmModal
        isOpen={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        onConfirm={() => void disconnect()}
        title="Desconectar a ZapSign"
        message="O token é removido do CRM e o webhook é apagado na ZapSign. Os documentos já enviados continuam valendo lá, mas o CRM deixa de receber o retorno. As regras por etapa ficam salvas, desligadas."
        confirmText="Desconectar"
        variant="danger"
      />
    </div>
  );
};

export default ZapSignSection;
