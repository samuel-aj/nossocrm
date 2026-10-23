import { AlertTriangle, BellRing } from 'lucide-react';
import type { DealAlert } from '@/types/types';
export function DealAlertBadge({ alert }: { alert?: DealAlert | null }) {
  if (!alert) return null;
  const attention = alert.tone === 'red';
  const Icon = attention ? AlertTriangle : BellRing;
  return <div className={`my-2 flex items-start gap-1.5 text-xs font-semibold ${attention ? 'text-red-700 dark:text-red-200' : 'text-emerald-800 dark:text-emerald-200'}`}><Icon size={14} className="mt-0.5 shrink-0" aria-hidden="true" /><span className="break-words"><span className="sr-only">{attention ? 'Atenção: ' : 'Aviso: '}</span>{alert.message}</span></div>;
}
