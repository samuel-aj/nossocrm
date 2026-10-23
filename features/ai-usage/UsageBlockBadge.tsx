import { Bot } from 'lucide-react';
import { usageBlockLabel, type UsageBlock } from '@/lib/ai-usage/alerts';

export const USAGE_BLOCK_TONE = 'border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200';

export function UsageBlockBadge({ block, className = '' }: { block: UsageBlock; className?: string }) {
  return <span className={`inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold leading-4 ${USAGE_BLOCK_TONE} ${className}`}
    title="A IA está pausada pelo controle de consumo. O responsável pode liberar saldo na conversa. Abrir o lead não remove este aviso.">
    <Bot size={14} className="shrink-0" aria-hidden="true" /><span>{usageBlockLabel(block.reason)}</span>
  </span>;
}
