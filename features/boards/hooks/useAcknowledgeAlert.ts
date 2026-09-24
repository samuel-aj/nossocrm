import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query';
import type { Deal, DealView } from '@/types';

export function clearExpectedAlert<T extends Deal>(deal: T, dealId: string, expectedId: string): T {
  return deal.id === dealId && deal.activeAlert?.id === expectedId ? { ...deal, activeAlert: null } : deal;
}
/** Snapshot only the first successfully resolved lead per user opening, never prefetch. */
export function useAcknowledgeAlert(isOpen: boolean, deal: Deal | undefined) {
  const opened = useRef<string | null>(null);
  const client = useQueryClient();
  useEffect(() => {
    if (!isOpen) { opened.current = null; return; }
    if (!deal || opened.current === deal.id) return;
    opened.current = deal.id;
    const expectedId = deal.activeAlert?.id;
    if (!expectedId) return;
    const dealId = deal.id;
    void fetch(`/api/deals/${dealId}/alert`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedId }) })
      .then(async response => {
        if (!response.ok) return;
        const result = await response.json();
        if (result.acknowledged) client.setQueryData<DealView[]>([...queryKeys.deals.lists(), 'view'], previous => previous?.map(item => clearExpectedAlert(item, dealId, expectedId)));
      }).catch(() => { /* Leave alert visible; another opening can retry. */ });
  }, [isOpen, deal, client]);
}
