'use client';
import { useEffect, useState } from 'react';
import {
  disablePushDevice, enablePushDevice, pushSupport, readPushDevice, type PushDeviceStatus, type PushScope,
} from '@/lib/notifications/pushDevice';

export function PushDeviceSettings({ scope, messages, onEnableMessages }: {
  scope: PushScope; messages: boolean; onEnableMessages: () => void;
}) {
  const [status, setStatus] = useState<PushDeviceStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const support = pushSupport();
  const { organizationId, userId } = scope;
  useEffect(() => {
    if (support !== 'ready') return;
    const controller = new AbortController();
    void readPushDevice({ organizationId, userId }, controller.signal)
      .then(result => { if (!controller.signal.aborted) setStatus(result); })
      .catch(() => { if (!controller.signal.aborted) setError('Não foi possível consultar os avisos do aparelho. Reabra as preferências para tentar novamente.'); });
    return () => controller.abort();
  }, [organizationId, userId, support]);

  async function toggle() {
    if (!status || busy) return;
    setBusy(true); setError('');
    try {
      if (status.enabled) await disablePushDevice(scope);
      else {
        if (!status.publicKey) return;
        await enablePushDevice(scope, status.publicKey);
        if (!messages) onEnableMessages();
      }
      setStatus({ ...status, enabled: !status.enabled });
    } catch (cause) {
      setError(cause instanceof Error && cause.name !== 'NotAllowedError' ? cause.message :
        'Autorize as notificações do CRM nas configurações do aparelho e tente novamente.');
    } finally { setBusy(false); }
  }

  return <section aria-label="Avisos no aparelho" className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
    <p className="text-sm font-medium">Mensagens com o CRM fechado</p>
    {support === 'install-ios' ? <p className="text-xs text-slate-500">No iPhone ou iPad, abra o CRM pelo ícone da Tela de Início. Para adicioná-lo, use Compartilhar no Safari.</p>
      : support === 'unsupported' ? <p className="text-xs text-slate-500">Este navegador não oferece notificações push. Use o Chrome no Android ou o app na Tela de Início no iOS 16.4 ou posterior.</p>
      : <>
        <p className="text-xs text-slate-500">{status?.enabled && !messages
          ? 'Marque Novas mensagens de leads e salve suas preferências para receber os avisos neste aparelho.'
          : status?.enabled
          ? 'Este aparelho está vinculado. Salve suas preferências para aplicar a seleção de leads.'
          : status && !status.publicKey ? 'O envio de notificações push ainda não foi configurado no servidor.'
            : 'Receba os avisos deste escritório no aparelho, conforme os leads selecionados.'}</p>
        <button type="button" disabled={busy || (!status?.enabled && !status?.publicKey)} onClick={()=>void toggle()}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium disabled:opacity-50 dark:border-slate-700">
          {busy ? 'Aguarde…' : status?.enabled ? 'Desativar neste aparelho' : 'Ativar neste aparelho'}
        </button>
      </>}
    {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
  </section>;
}
