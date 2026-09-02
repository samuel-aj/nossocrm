'use client';

/**
 * ID técnico copiável, sem expor o valor: mostra só "⧉ ID da etapa" e, ao
 * clicar, copia o ID real e confirma com "✓ ID copiado". Padrão para toda
 * entidade do CRM (board, etapa, agente, robô, conexão do WhatsApp, produto...).
 * O ID inteiro fica no `title` para quem precisar conferir.
 */
import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CopyId({
  value,
  label = 'ID',
  className,
  size = 'sm',
}: {
  /** O ID real (o que vai para a área de transferência) */
  value: string;
  /** Rótulo visível: "ID da etapa", "ID do agente"... */
  label?: string;
  className?: string;
  size?: 'sm' | 'xs';
}) {
  const [copied, setCopied] = useState(false);
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Sem permissão ou fora de HTTPS: o title mantém o valor à mão
      window.prompt('Copie o ID:', value);
    }
  };
  return (
    <button
      type="button"
      onClick={(e) => void copy(e)}
      title={`Copiar: ${value}`}
      aria-label={copied ? 'ID copiado' : `Copiar ${label}`}
      className={`inline-flex items-center gap-1 rounded-md border transition-colors select-none ${
        size === 'xs' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-xs'
      } ${
        copied
          ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-500/30 dark:bg-green-900/20 dark:text-green-300'
          : 'border-slate-200 bg-white text-slate-500 hover:text-primary-700 hover:border-primary-300 dark:border-white/10 dark:bg-white/5 dark:text-slate-400 dark:hover:text-primary-300 dark:hover:border-primary-500/40'
      } ${className ?? ''}`}
    >
      {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
      <span className="font-medium">{copied ? 'ID copiado' : label}</span>
    </button>
  );
}

export default CopyId;
