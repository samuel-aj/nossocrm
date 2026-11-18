'use client';

import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, History } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import type { Profile } from '@/context/AuthContext';
import { WhatsAppConnectionHistory } from './WhatsAppConnectionHistory';
import { LineAlertOwner } from './WhatsAppLineHealth';

type Props = {
  connectionId: string;
  lineLabel: string;
  ownerId: string | null;
  profile: Pick<Profile, 'id' | 'organization_id'> | null;
  canEdit: boolean;
};

const actionClass = 'inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible-ring dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5';

export function ConnectionCardActions({ connectionId, lineLabel, ownerId, profile, canEdit }: Props) {
  const [dialog, setDialog] = useState<'alerts' | 'history' | null>(null);
  const lineDescriptionId = useId();

  return <div className="col-start-2 row-start-1 flex items-start justify-self-end gap-1.5 sm:col-start-3">
    <button type="button" aria-label={`Alertas de conexão de ${lineLabel}`} title="Alertas de conexão"
      aria-haspopup="dialog" className={`${actionClass} w-11`} onClick={() => setDialog('alerts')}>
      <Bell size={17} aria-hidden />
    </button>
    {profile?.organization_id && <button type="button" aria-label={`Histórico de ${lineLabel}`} aria-haspopup="dialog"
      className={`${actionClass} px-2.5`} onClick={() => setDialog('history')}>
      <History size={16} aria-hidden /> Histórico
    </button>}
    {dialog && (dialog === 'alerts' || profile?.organization_id) && createPortal(
      <Modal isOpen onClose={() => setDialog(null)} size={dialog === 'alerts' ? 'lg' : 'xl'}
        title={dialog === 'alerts' ? 'Alertas de conexão' : 'Histórico da conexão'} describedById={lineDescriptionId}>
        <p id={lineDescriptionId} className="mb-3 break-words text-sm font-semibold text-slate-700 dark:text-slate-200">{lineLabel}</p>
        {dialog === 'alerts'
          ? <LineAlertOwner connectionId={connectionId} ownerId={ownerId} canEdit={canEdit} />
          : profile?.organization_id && <div className="text-sm text-slate-600 dark:text-slate-300">
              <WhatsAppConnectionHistory connectionId={connectionId} organizationId={profile.organization_id} userId={profile.id} />
            </div>}
      </Modal>,
      document.body,
    )}
  </div>;
}
