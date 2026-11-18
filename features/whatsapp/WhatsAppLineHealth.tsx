'use client';

import { AlertTriangle, CheckCircle2, Clock3, HelpCircle, Unplug } from 'lucide-react';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/context/ToastContext';
import { useOrgMembers } from '@/lib/query/hooks';
import type { ConnectionDiagnostics } from '@/lib/whatsapp/connectionDiagnostics';

const badges = {
  connected: { label: 'Conectado', icon: CheckCircle2, style: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
  connecting: { label: 'Aguardando conexão', icon: Clock3, style: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  disconnected: { label: 'Desconectado', icon: Unplug, style: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300' },
  send_failure: { label: 'Envio interrompido', icon: AlertTriangle, style: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300' },
  recent_errors: { label: 'Falhas de envio recentes', icon: AlertTriangle, style: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  unknown: { label: 'Status não confirmado', icon: HelpCircle, style: 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300' },
};

export function LineStatusBadge({ state }: { state: ConnectionDiagnostics['state'] }) {
  const { icon: Icon, label, style } = badges[state];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${style}`}>
    <Icon size={12} aria-hidden />{label}
  </span>;
}

const time = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function LineHealthDetails({ health }: { health?: ConnectionDiagnostics }) {
  return <div className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-400">
    {health?.identityMismatch && <p className="font-medium text-red-700 dark:text-red-300">
      O telefone pareado é diferente do telefone cadastrado. Reconecte o número original para liberar os envios.
    </p>}
    {health?.incidentOpenedAt && <p className="font-medium text-red-700 dark:text-red-300">
      Incidente de conexão desde {time(health.incidentOpenedAt)}.
      {health.receivedDuringIncidentAt && ` O número recebeu mensagem em ${time(health.receivedDuringIncidentAt)} durante o incidente.`}
    </p>}
    {health?.lastIncident && <div className="space-y-0.5">
      {health.lastIncident.resolvedAt && <p className="font-medium">
        Último incidente de {time(health.lastIncident.openedAt)} a {time(health.lastIncident.resolvedAt)}.
      </p>}
      <p>{health.lastIncident.observation}</p>
      <p>{health.lastIncident.observedBy} · <time dateTime={health.lastIncident.observedAt}>{time(health.lastIncident.observedAt)}</time></p>
      {health.lastIncident.detectedBy !== health.lastIncident.observedBy && <p>
        Origem do incidente · {health.lastIncident.detectedBy}
      </p>}
    </div>}
    {!health?.incidentOpenedAt && Boolean(health?.failedCount) && <p className="text-red-700 dark:text-red-300">
      Os últimos {health?.failedCount} envios falharam.
    </p>}
    <div className="flex flex-wrap gap-x-5 gap-y-1">
      <span>Última verificação · {health?.lastCheckedAt ? time(health.lastCheckedAt) : 'Sem registro'}</span>
      <span>Último envio com entrega confirmada · {health?.lastDeliveredMessageAt ? time(health.lastDeliveredMessageAt) : health?.historyAvailable ? 'Sem registro' : 'Indisponível'}</span>
    </div>
    {!!health?.pendingCount && <p>{health.pendingCount} {health.pendingCount === 1 ? 'envio em recuperação' : 'envios em recuperação'}</p>}
    {!!health?.reviewCount && <p className="font-medium text-amber-700 dark:text-amber-300">
      {health.reviewCount} {health.reviewCount === 1 ? 'envio aguarda' : 'envios aguardam'} conferência da equipe. Verifique a entrega na conversa antes de reenviar.
    </p>}
  </div>;
}

export function LineAlertOwner({ connectionId, ownerId }: { connectionId: string; ownerId: string | null }) {
  const qc = useQueryClient();
  const { addToast } = useToast();
  const members = useOrgMembers();
  const save = useMutation({
    mutationFn: async (value: string) => {
      const res = await fetch('/api/whatsapp/connection/alert-owner', {
        method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ connectionId, ownerId: value || null }),
      });
      if (!res.ok) throw new Error('Não foi possível salvar o responsável pelos alertas.');
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['waConnection'] }); },
    onError: (error: Error) => addToast(error.message, 'error'),
  });
  const options = (members.data || []).filter(member => member.member);
  const fieldId = `wa-alert-owner-${connectionId}`;
  return <div className="mt-3 max-w-sm space-y-1">
    <label htmlFor={fieldId} className="text-xs font-semibold text-slate-700 dark:text-slate-300">Responsável pelos alertas</label>
    <NativeSelect id={fieldId} value={save.isPending ? save.variables : ownerId || ''} disabled={save.isPending || !members.isSuccess}
      onChange={event => save.mutate(event.target.value)} className="w-full text-xs">
      <option value="">Somente administradores</option>
      {ownerId && !options.some(m => m.id === ownerId) && <option value={ownerId} disabled>Responsável cadastrado</option>}
      {options.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
    </NativeSelect>
    {members.isError && <p className="text-xs text-red-700 dark:text-red-300">Não foi possível carregar os membros da equipe.</p>}
  </div>;
}
