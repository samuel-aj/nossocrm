'use client';

/**
 * Modelos de mensagem dentro do robô: lista (com cache compartilhado), prévia
 * estilo WhatsApp com as variáveis destacadas e preenchidas com exemplo, e
 * todos os botões (resposta rápida vira saída; link e telefone só aparecem).
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { TEMPLATE_VARIABLES } from '@/lib/messageTemplates';

export type TemplateButton = { type: string; text: string };
export type TemplateOption = {
  id: string;
  name: string;
  type: 'general' | 'whatsapp_api';
  meta_status?: string | null;
  body: string;
  connection_id?: string | null;
  buttons?: TemplateButton[] | null;
};

export function useMessageTemplates() {
  return useQuery<{ data: TemplateOption[] }>({
    queryKey: ['messageTemplates'],
    queryFn: async () => {
      const res = await fetch('/api/message-templates', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 60000,
  });
}

/** Textos dos botões de resposta rápida (os que viram saídas do balão). */
export function quickReplyTexts(template: Pick<TemplateOption, 'buttons'> | undefined): string[] {
  return (template?.buttons ?? []).filter((b) => b.type === 'QUICK_REPLY').map((b) => b.text);
}

/** true quando o modelo pode ser usado por um robô desses números (geral vale em todos). */
export function templateFitsNumbers(template: TemplateOption, connectionIds: string[]): boolean {
  if (template.type !== 'whatsapp_api' || !template.connection_id) return true;
  return connectionIds.length === 0 || connectionIds.includes(template.connection_id);
}

const SAMPLE_BY_KEY = new Map(TEMPLATE_VARIABLES.map((v) => [v.key, v]));

/** Texto do modelo com as variáveis trocadas pelo exemplo (resumo curto no balão). */
export function templatePlainPreview(body: string): string {
  let out = body;
  for (const v of TEMPLATE_VARIABLES) out = out.split(v.key).join(v.sample);
  return out;
}

/** Corpo com as variáveis destacadas: {{contato.nome}} aparece como "Maria Silva" marcado. */
function HighlightedBody({ body }: { body: string }) {
  const parts = body.split(/(\{\{[^{}]+\}\})/g);
  return (
    <>
      {parts.map((part, i) => {
        const known = SAMPLE_BY_KEY.get(part);
        if (known) {
          return (
            <mark key={i} className="rounded bg-amber-200/70 dark:bg-amber-500/30 px-0.5 text-inherit" title={`${known.label} (${part})`}>
              {known.sample}
            </mark>
          );
        }
        if (/^\{\{[^{}]+\}\}$/.test(part)) {
          return (
            <mark key={i} className="rounded bg-red-200/70 dark:bg-red-500/30 px-0.5 text-inherit" title="Variável da Meta: o robô envia vazia">
              {part}
            </mark>
          );
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </>
  );
}

/** Balão estilo WhatsApp com o corpo e os botões do modelo. */
export function TemplateBubble({ body, buttons }: { body: string; buttons: TemplateButton[] }) {
  return (
    <div className="space-y-1">
      <div className="rounded-2xl rounded-tl-md bg-[#d9fdd3] dark:bg-[#005c4b] px-3 py-2 text-sm leading-snug text-slate-900 dark:text-white whitespace-pre-wrap break-words">
        {body.trim() ? <HighlightedBody body={body} /> : <span className="opacity-60">Modelo sem texto</span>}
      </div>
      {buttons.length > 0 ? (
        <div className="grid gap-1">
          {buttons.map((b, i) => (
            <span
              key={`${b.text}-${i}`}
              className={`rounded-lg border px-2 py-1 text-center text-xs font-medium ${
                b.type === 'QUICK_REPLY'
                  ? 'border-emerald-300 text-emerald-700 dark:border-emerald-500/50 dark:text-emerald-300'
                  : 'border-slate-300 text-slate-500 dark:border-white/20 dark:text-slate-400'
              }`}
            >
              {b.text}
              {b.type === 'QUICK_REPLY' ? '' : b.type === 'URL' ? ' (abre link)' : ' (liga)'}
            </span>
          ))}
        </div>
      ) : null}
      {/\{\{\d+\}\}/.test(body) ? (
        <p className="text-[11px] text-red-600 dark:text-red-400">
          Este modelo usa variáveis numeradas da Meta ({'{{1}}'}): o robô não sabe o que colocar nelas. Crie o modelo pelo
          CRM com as variáveis nomeadas.
        </p>
      ) : null}
    </div>
  );
}
