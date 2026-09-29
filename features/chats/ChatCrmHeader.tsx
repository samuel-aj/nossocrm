import React from 'react';
import { ExternalLink, KanbanSquare, Plus, Tag, User, UserPlus, Users } from 'lucide-react';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { LABEL_CHIP_CLASS, LABEL_DOT_CLASS, type WaLabel } from '@/lib/whatsapp/labels';

type DealChoice = { id: string; title: string };

type ChatCrmHeaderProps = {
  isGroup?: boolean;
  participantsCount?: number | null;
  loading?: boolean;
  unavailable?: boolean;
  linkError?: boolean;
  conversationId: string | null;
  contactId: string | null;
  deal: DealChoice | null;
  contactDeals: DealChoice[];
  saving: boolean;
  detailsOpen: boolean;
  stage?: React.ReactNode;
  ownerName: string | null;
  labels: WaLabel[];
  onLinkDeal: (dealId: string | null) => void;
  onOpenDeal: () => void;
  onCreateLead: () => void;
  onAddContact: () => void;
  onOpenLabels: () => void;
  onRetryLink: () => void;
};

export function ChatCrmHeader({
  isGroup,
  participantsCount,
  loading,
  unavailable,
  linkError,
  conversationId,
  contactId,
  deal,
  contactDeals,
  saving,
  detailsOpen,
  stage,
  ownerName,
  labels,
  onLinkDeal,
  onOpenDeal,
  onCreateLead,
  onAddContact,
  onOpenLabels,
  onRetryLink,
}: ChatCrmHeaderProps) {
  return (
    <div role="group" aria-label="Contexto CRM da conversa" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 border-t border-slate-200 dark:border-white/10 text-xs text-slate-600 dark:text-slate-300">
      {isGroup ? (
        <span className="inline-flex min-w-0 items-center gap-2 text-slate-500 dark:text-slate-400">
          <Users size={14} className="shrink-0" />
          <span className="truncate">Grupo do WhatsApp{participantsCount ? ` · ${participantsCount} participantes` : ''}. Grupos não viram contato nem lead.</span>
        </span>
      ) : (
        <>
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            {loading ? (
              <span role="status" className="text-slate-500">Carregando lead…</span>
            ) : unavailable || linkError ? (
              <button type="button" onClick={onRetryLink} className="text-primary-600 underline">
                {unavailable ? 'Lead vinculado indisponível. Tentar novamente' : 'Não foi possível consultar o vínculo. Tentar novamente'}
              </button>
            ) : conversationId && (contactDeals.length > 0 || deal) ? (
              <>
                <KanbanSquare size={14} className="shrink-0 text-primary-500" aria-hidden="true" />
                <NativeSelect
                  value={deal?.id ?? ''}
                  disabled={saving}
                  searchable
                  onChange={e => onLinkDeal(e.target.value || null)}
                  aria-label="Lead vinculado a esta conversa"
                  title="Ao vincular, as etiquetas da conversa e do lead serão unidas."
                  className="min-h-0 min-w-0 w-[180px] max-w-[calc(100vw-120px)] truncate rounded-lg border border-slate-300 dark:border-white/20 bg-white dark:bg-dark-card px-1.5 py-1 text-xs outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Sem lead vinculado</option>
                  {deal && !contactDeals.some(d => d.id === deal.id) && <option value={deal.id}>{deal.title}</option>}
                  {contactDeals.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
                </NativeSelect>
                {deal && (
                  <button type="button" onClick={onOpenDeal} aria-label="Abrir lead" title="Abrir lead" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 focus-visible-ring">
                    <ExternalLink size={14} />
                  </button>
                )}
              </>
            ) : contactId ? (
              <span className="min-w-0 text-slate-400 italic">Conversa sem lead vinculado.</span>
            ) : (
              <span className="min-w-0 text-amber-600 dark:text-amber-400">Número sem contato no CRM. Adicione pra criar o lead.</span>
            )}
          </div>

          {deal && !loading && !unavailable && !linkError && !detailsOpen && stage && <span className="min-w-0 w-[260px] max-w-full">{stage}</span>}

          {conversationId && !detailsOpen && (
            <span title="Responsável do lead deste contato. Para mudar, troque no lead." className={`inline-flex min-w-0 max-w-full items-center gap-1.5 px-2.5 py-1 rounded-full font-bold border ${ownerName ? 'border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400'}`}>
              <User size={12} className="shrink-0" />
              <span className="truncate">{ownerName || 'Sem responsável'}</span>
            </span>
          )}

          {!deal && !loading && !unavailable && !linkError && (
            contactId ? (
              <button type="button" onClick={onCreateLead} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white transition-colors hover:bg-emerald-500"><Plus size={13} /> Criar lead</button>
            ) : (
              <button type="button" onClick={onAddContact} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white transition-colors hover:bg-emerald-500"><UserPlus size={13} /> Adicionar contato</button>
            )
          )}
        </>
      )}
      {conversationId && (
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
          {labels.slice(0, 3).map(label => (
            <span key={label.id} className={`inline-flex max-w-[130px] items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold ring-1 ring-inset ${LABEL_CHIP_CLASS[label.color]}`}>
              <span className={`h-2 w-2 shrink-0 rounded-full ${LABEL_DOT_CLASS[label.color]}`} />
              <span className="truncate">{label.name}</span>
            </span>
          ))}
          {labels.length > 3 && (
            <span title={labels.slice(3).map(label => label.name).join(', ')} className="rounded-md bg-slate-100 px-1.5 py-1 text-[11px] font-bold text-slate-500 dark:bg-white/10 dark:text-slate-400">+{labels.length - 3}</span>
          )}
          <button type="button" onClick={onOpenLabels} disabled={saving} className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2 py-1 text-[11px] font-bold text-slate-500 transition-colors hover:border-primary-300 hover:text-primary-600 disabled:opacity-50 dark:border-white/15 dark:text-slate-400">
            <Tag size={11} /> Etiquetar
          </button>
        </div>
      )}
    </div>
  );
}

export function ChatCrmHeaderActions({ hasDeal, detailsOpen, onToggleDetails }: {
  hasDeal: boolean;
  detailsOpen: boolean;
  onToggleDetails: () => void;
}) {
  if (!hasDeal) return null;
  return (
    <button
      type="button"
      aria-label={detailsOpen ? 'Ocultar propriedades do lead' : 'Mostrar propriedades do lead'}
      aria-expanded={detailsOpen}
      onClick={onToggleDetails}
      className="inline-flex shrink-0 items-center rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-primary-600 hover:bg-primary-50 dark:border-white/10 dark:text-primary-400 dark:hover:bg-white/10"
    >
      {detailsOpen ? 'Ocultar propriedades' : 'Propriedades'}
    </button>
  );
}
