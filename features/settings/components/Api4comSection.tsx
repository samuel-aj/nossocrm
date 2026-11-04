'use client';

/**
 * Telefonia pela API4com.
 * - Api4comPersonalCard (Configurações > Geral, para todos): cada pessoa conecta
 *   o PRÓPRIO token, porque a API4com tem token e ramal por usuário.
 * - Api4comSection (Configurações > Integrações, admin): o cartão pessoal, quem
 *   da equipe já conectou e como funciona.
 * O token nunca volta inteiro do servidor.
 */
import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Phone, PhoneOff, Unplug, Users } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import ConfirmModal from '@/components/ConfirmModal';
import { API4COM_ME_KEY, API4COM_TEAM_KEY, connectApi4com, disconnectApi4com, useApi4comMe, useApi4comTeam } from '@/features/api4com/useApi4com';
import { useApi4comPhone } from '@/features/api4com/phone/Api4comPhoneProvider';
import { SETTINGS_BTN_PRIMARY, SETTINGS_BTN_SECONDARY, SETTINGS_INPUT_CLASS, SettingsCard, SettingsEmpty, SettingsRow } from './SettingsUi';

const DT = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export const Api4comPersonalCard: React.FC = () => {
  const { addToast } = useToast();
  const qc = useQueryClient();
  const me = useApi4comMe();
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const s = me.data?.connected ? me.data : null;

  const connect = async () => {
    if (!token.trim()) return;
    setSaving(true);
    try {
      const body = await connectApi4com(token.trim());
      setToken('');
      qc.setQueryData(API4COM_ME_KEY, body);
      void qc.invalidateQueries({ queryKey: API4COM_TEAM_KEY });
      const ok = body.connected && body.webhook_ok;
      addToast(ok ? 'API4com conectada. O botão Ligar já aparece no topo da conversa do lead.' : 'API4com conectada, mas o retorno das ligações não foi cadastrado. Veja o aviso.', ok ? 'success' : 'warning');
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
      const body = await disconnectApi4com();
      qc.setQueryData(API4COM_ME_KEY, body);
      void qc.invalidateQueries({ queryKey: API4COM_TEAM_KEY });
      addToast('API4com desconectada.', 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Falha ao desconectar', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsCard
      title="Telefonia (API4com)"
      icon={Phone}
      description="Ligue para o lead com um clique. A ligação e a gravação ficam no histórico."
      right={
        s ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 size={13} aria-hidden="true" /> Conectada
          </span>
        ) : null
      }
    >
      {me.isLoading ? (
        <p className="inline-flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Carregando...
        </p>
      ) : me.error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{(me.error as Error).message}</p>
      ) : s ? (
        <div>
          <SettingsRow
            title={s.name || s.email || 'Seu usuário na API4com'}
            description={`Ramal ${s.extension ?? '?'}${s.email && s.name ? ` · ${s.email}` : ''} · token ${s.token_hint}`}
            control={
              <button type="button" onClick={() => setConfirmDisconnect(true)} disabled={saving} className={SETTINGS_BTN_SECONDARY}>
                <Unplug size={14} aria-hidden="true" /> Desconectar
              </button>
            }
          />
          <SettingsRow
            title="Retorno das ligações"
            description={
              s.webhook_ok
                ? 'Cadastrado na API4com. Quando a ligação termina, o CRM registra o resultado, a duração e a gravação.'
                : 'Não cadastrado. As ligações saem, mas o CRM não fica sabendo do resultado. Conecte de novo com o token para tentar outra vez.'
            }
            control={s.webhook_ok ? <CheckCircle2 size={18} className="text-emerald-500" aria-label="Retorno cadastrado" /> : <AlertTriangle size={18} className="text-amber-500" aria-label="Retorno não cadastrado" />}
          >
            {s.last_error ? <p className="text-xs text-amber-700 dark:text-amber-300">{s.last_error}</p> : null}
          </SettingsRow>
          <PhoneStatusRow />
        </div>
      ) : (
        <div className="space-y-4">
          <ol className="list-decimal pl-5 space-y-1 text-sm text-slate-600 dark:text-slate-300">
            <li>
              Entre no{' '}
              <a className="underline" href="https://app.api4com.com/login" target="_blank" rel="noreferrer">
                painel da API4com
              </a>{' '}
              com o <strong>seu</strong> usuário e abra <strong>Tokens de acesso</strong>.
            </li>
            <li>Crie um token <strong>sem expiração</strong>, copie e cole abaixo.</li>
            <li>Pronto: você liga pelo botão Ligar do lead e fala pelo microfone do computador, sem instalar nada.</li>
          </ol>
          <div>
            <label htmlFor="api4com-token" className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              Token de acesso
            </label>
            <input
              id="api4com-token"
              type="password"
              autoComplete="off"
              className={SETTINGS_INPUT_CLASS}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void connect();
              }}
              placeholder="Cole aqui o seu token da API4com"
            />
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Cada pessoa usa o próprio token: a ligação sai pelo ramal de quem conectou.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void connect()} disabled={saving || !token.trim()} className={SETTINGS_BTN_PRIMARY}>
              {saving ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Phone size={14} aria-hidden="true" />} Conectar
            </button>
            <a className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-primary-600 underline" href="https://developers.api4com.com/" target="_blank" rel="noreferrer">
              Documentação da API4com <ExternalLink size={11} aria-hidden="true" />
            </a>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        onConfirm={() => void disconnect()}
        title="Desconectar a API4com"
        message="O seu token sai do CRM e o retorno das ligações é apagado na API4com. As ligações já registradas continuam no histórico dos leads."
        confirmText="Desconectar"
        variant="danger"
      />
    </SettingsCard>
  );
};

/** Estado do telefone embutido e o botão para ligar/desligar. */
const PhoneStatusRow: React.FC = () => {
  const { addToast } = useToast();
  const phone = useApi4comPhone();
  const [busy, setBusy] = useState(false);
  if (!phone) return null;
  const st = phone.phone.status;
  const on = st === 'online' || st === 'reconnecting';
  const inCall = !!phone.phone.session;
  const description = phone.otherTab
    ? 'O telefone está ligado em outra aba do CRM. Ao clicar em Ligar aqui, ele passa para esta aba.'
    : st === 'online'
      ? 'Ligado nesta aba. As ligações saem pelo microfone e pelo fone ou caixa de som deste computador.'
      : st === 'reconnecting'
        ? 'A conexão com a central caiu. Reconectando sozinho...'
        : st === 'connecting'
          ? 'Conectando ao seu ramal...'
          : st === 'error'
            ? phone.phone.error || 'Não foi possível ligar o telefone.'
            : 'Desligado. Ele liga sozinho quando você clica em Ligar no lead. Se o Webphone da API4com estiver aberto em algum lugar, feche: os dois no mesmo ramal se atrapalham.';

  const turnOn = async () => {
    setBusy(true);
    try {
      await phone.goOnline();
      addToast('Telefone do CRM ligado.', 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Não foi possível ligar o telefone.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsRow
      title="Telefone do CRM"
      description={description}
      control={
        on ? (
          <button type="button" onClick={phone.goOffline} disabled={inCall} className={SETTINGS_BTN_SECONDARY} title={inCall ? 'Termine a ligação antes' : undefined}>
            <PhoneOff size={14} aria-hidden="true" /> Desligar telefone
          </button>
        ) : (
          <button type="button" onClick={() => void turnOn()} disabled={busy || st === 'connecting'} className={SETTINGS_BTN_PRIMARY}>
            {busy || st === 'connecting' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Phone size={14} aria-hidden="true" />} Ligar telefone
          </button>
        )
      }
    >
      <p className={`inline-flex items-center gap-1.5 text-xs font-semibold ${st === 'online' ? 'text-emerald-700 dark:text-emerald-300' : st === 'error' ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}>
        <span className={`h-2 w-2 rounded-full ${st === 'online' ? 'bg-emerald-500' : st === 'error' ? 'bg-red-500' : st === 'off' ? 'bg-slate-300 dark:bg-slate-600' : 'bg-amber-400 animate-pulse'}`} aria-hidden="true" />
        {phone.otherTab ? 'Em outra aba' : st === 'online' ? 'Ligado' : st === 'reconnecting' ? 'Reconectando' : st === 'connecting' ? 'Conectando' : st === 'error' ? 'Com erro' : 'Desligado'}
      </p>
    </SettingsRow>
  );
};

export const Api4comSection: React.FC = () => {
  const team = useApi4comTeam();
  const users = team.data?.users ?? [];
  return (
    <div className="space-y-6">
      <Api4comPersonalCard />

      <SettingsCard title="Quem da equipe já conectou" icon={Users} description="Cada pessoa conecta o próprio token em Configurações > Geral.">
        {team.isLoading ? (
          <p className="text-sm text-slate-500">Carregando...</p>
        ) : team.error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{(team.error as Error).message}</p>
        ) : team.data?.pendingMigration ? (
          <p className="text-sm text-amber-700 dark:text-amber-300">A integração com a API4com ainda não foi instalada nesta conta.</p>
        ) : users.length === 0 ? (
          <SettingsEmpty>Ninguém conectou ainda.</SettingsEmpty>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-white/5 rounded-lg border border-slate-200 dark:border-white/10">
            {users.map((u) => (
              <li key={u.user_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-800 dark:text-slate-100">{u.name}</span>
                  <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">
                    Ramal {u.extension ?? '?'}
                    {u.verified_at ? ` · desde ${DT.format(new Date(u.verified_at))}` : ''}
                  </span>
                </span>
                {u.webhook_ok ? (
                  <CheckCircle2 size={16} className="shrink-0 text-emerald-500" aria-label="Retorno cadastrado" />
                ) : (
                  <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300" title={u.last_error ?? undefined}>
                    <AlertTriangle size={13} aria-hidden="true" /> sem retorno
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>

      <SettingsCard title="Como funciona" description="Do clique até o histórico do lead.">
        <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600 dark:text-slate-300">
          <li>A conta da API4com do escritório precisa ter um usuário com plano (e ramal) para cada pessoa que vai ligar.</li>
          <li>Cada pessoa conecta o próprio token em Configurações &gt; Geral. O botão Ligar aparece no topo da conversa do lead, ao lado de IA Insights.</li>
          <li>O telefone fica dentro do CRM: a pessoa fala pelo microfone e ouve pelo fone ou caixa de som do computador, sem Webphone nem extensão.</li>
          <li>Navegar pelo CRM não derruba a ligação. Recarregar a página derruba. O telefone fica em uma aba só.</li>
          <li>Quando a ligação termina, o histórico do lead registra quem ligou, o resultado (atendida, não atendida, ocupado, caixa postal), a duração e o link da gravação.</li>
          <li>Só as ligações feitas pelo CRM entram no histórico. As feitas direto no Webphone continuam só na API4com.</li>
        </ul>
      </SettingsCard>
    </div>
  );
};

export default Api4comSection;
