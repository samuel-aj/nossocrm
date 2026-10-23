import { BellRing, Bot, MessageCircle, UserRoundPlus } from 'lucide-react';
import type { Notice } from '@/lib/notifications/types';

export function noticeTone(notice: Pick<Notice, 'category' | 'tone'>) {
  return notice.category === 'ai_usage' ? 'violet' : notice.tone === 'red' ? 'red' : 'green';
}
const TONES = {
  violet: { panel: 'border-violet-200 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/40', icon: 'bg-violet-100 text-violet-700 dark:bg-violet-900/60 dark:text-violet-200', label: 'text-violet-800 dark:text-violet-200' },
  green: { panel: 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30', icon: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200', label: 'text-emerald-800 dark:text-emerald-200' },
  red: { panel: 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30', icon: 'bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-200', label: 'text-red-800 dark:text-red-200' },
};
export function noticePanelClass(notice: Notice) { return TONES[noticeTone(notice)].panel; }

export function NoticeContent({ notice, time }: { notice: Notice; time?: string }) {
  const tone = TONES[noticeTone(notice)];
  const Icon = notice.category === 'ai_usage' ? Bot : notice.kind === 'message' ? MessageCircle : notice.kind === 'lead' ? UserRoundPlus : BellRing;
  return <div className="flex items-start gap-3">
    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone.icon}`}><Icon size={17} aria-hidden="true" /></span>
    <div className="min-w-0"><p className={`text-sm font-semibold ${tone.label}`}>{notice.title}</p><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{notice.message}</p>{time && <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{time}</p>}</div>
  </div>;
}
