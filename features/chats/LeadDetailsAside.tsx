'use client';

import React from 'react';
import { FocusTrap } from '@/lib/a11y';
import { LeadPropertiesPanel } from '@/features/deals/lead/LeadPropertiesPanel';
import type { Contact, Deal, DealView } from '@/types';

type Props = {
  deal: Deal | DealView;
  contact: Contact | null;
  open: boolean;
  drawer: boolean;
  onClose: () => void;
};

export function LeadDetailsAside({ deal, contact, open, drawer, onClose }: Props) {
  return (
    <div
      role={drawer && open ? 'dialog' : undefined}
      aria-label={drawer && open ? 'Propriedades do lead' : undefined}
      aria-modal={drawer && open ? true : undefined}
      aria-hidden={!open}
      inert={!open}
      className={`${open ? 'block' : 'hidden'} min-h-0 [&>[data-focus-trap-fallback]]:h-full ${drawer ? 'absolute inset-y-0 right-0 z-30 w-[min(360px,100%)] shadow-2xl' : 'w-[360px] shrink-0'}`}
    >
      <FocusTrap active={drawer && open} onEscape={onClose}>
        <div className="h-full min-h-0 border-l border-slate-200 bg-white dark:border-white/10 dark:bg-dark-card">
          <LeadPropertiesPanel key={deal.id} deal={deal} contact={contact} side="right" onClose={onClose} onDeleted={onClose} />
        </div>
      </FocusTrap>
    </div>
  );
}
