import { BellRing } from 'lucide-react';
import type { DealAlert } from '@/types/types';
export function DealAlertBadge({ alert }: { alert?: DealAlert | null }) {
  if (!alert) return null;
  return <div className="my-2 flex items-start gap-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-200"><BellRing size={14} className="mt-0.5 shrink-0" aria-hidden="true" /><span className="break-words">{alert.message}</span></div>;
}
