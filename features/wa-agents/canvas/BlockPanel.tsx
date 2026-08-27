'use client';

/**
 * Painel de propriedades do bloco apontado no quadro: gaveta lateral no
 * desktop e folha inferior no celular. Os campos de cada tipo de bloco moram
 * aqui (o balão só mostra ícone, título e resumo).
 */
import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2, X } from 'lucide-react';
import { AgentSelect, StageSelect, TagInput } from '../OutcomesEditor';
import { useWaBotsList } from '../useWaAgents';
import { BTN_ICON, HELP_CLASS, INPUT_CLASS, newId } from '../ui';
import { BlockIcon, NODE_META } from './catalog';
import { useCanvasContext } from './context';
import { bubbleTitle } from './serialize';
import {
  BOT_VARIABLES,
  MAX_REPLY_MINUTES,
  MAX_WAIT_SECONDS,
  WAIT_UNIT_LABELS,
  WAIT_UNIT_SECONDS,
  type Block,
  type BlockOfType,
  type BubbleNode,
  type ConditionRuleDraft,
  type WaitUnit,
} from './types';

export type BlockPanelProps = {
  bubble: BubbleNode;
  block: Block;
  /** Posição do bloco no balão (0-based). */
  index: number;
  /** Substitui o bloco (mesmo id) pelos dados editados. */
  update: (block: Block) => void;
  onClose: () => void;
  onRemove: () => void;
};

const LABEL_CLASS = 'block text-xs font-medium text-slate-600 dark:text-slate-300';

/** Campo numérico que aceita digitação livre e só aplica o limite ao sair do campo. */
function NumberField({
  id,
  value,
  min,
  max,
  onCommit,
  ariaLabel,
  className,
}: {
  id?: string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
  ariaLabel: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      id={id}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      className={className ?? INPUT_CLASS}
      value={draft ?? String(value)}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== '' && Number.isFinite(n)) onCommit(Math.round(n));
      }}
      onBlur={() => {
        if (draft !== null) {
          const n = Number(draft);
          onCommit(draft === '' || !Number.isFinite(n) ? min : Math.max(min, Math.min(max, Math.round(n))));
        }
        setDraft(null);
      }}
      aria-label={ariaLabel}
    />
  );
}

function autoResize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

type EditorProps<T extends Block['type']> = { block: BlockOfType<T>; update: (block: Block) => void };

// ---------------------------------------------------------------- Mensagem

function MessageEditor({ block, update }: EditorProps<'send_text'>) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const text = block.data.text;

  useEffect(() => {
    autoResize(textRef.current);
  }, [text]);

  const setText = (value: string) => update({ ...block, data: { text: value } });

  const insert = (key: string) => {
    const el = textRef.current;
    const startPos = el?.selectionStart ?? text.length;
    const endPos = el?.selectionEnd ?? text.length;
    setText(text.slice(0, startPos) + key + text.slice(endPos));
    const caret = startPos + key.length;
    window.setTimeout(() => {
      const target = textRef.current;
      if (!target) return;
      target.focus();
      target.setSelectionRange(caret, caret);
    }, 0);
  };

  return (
    <>
      <label htmlFor={`block-${block.id}-text`} className={LABEL_CLASS}>
        Texto da mensagem
      </label>
      <div className="rounded-2xl rounded-tl-md bg-[#d9fdd3] dark:bg-[#005c4b] px-3 py-2 shadow-sm">
        <textarea
          id={`block-${block.id}-text`}
          ref={textRef}
          autoFocus
          className="w-full bg-transparent resize-none outline-none text-sm leading-snug text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-emerald-100/70"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Escreva a mensagem..."
          maxLength={4000}
        />
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Variáveis disponíveis">
        {BOT_VARIABLES.map((v) => (
          <button
            key={v.key}
            type="button"
            className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
            title={`Inserir ${v.description}`}
            onClick={() => insert(v.key)}
          >
            {v.key}
          </button>
        ))}
      </div>
      <p className={HELP_CLASS}>
        {text.length}/4000 caracteres. Cada bloco Mensagem vira uma mensagem separada no WhatsApp: para mandar várias em
        sequência, empilhe blocos no mesmo balão.
      </p>
    </>
  );
}

// ---------------------------------------------------------------- Esperar

function maxAmountFor(unit: WaitUnit): number {
  return Math.floor(MAX_WAIT_SECONDS / WAIT_UNIT_SECONDS[unit]);
}

function WaitEditor({ block, update }: EditorProps<'wait'>) {
  const { amount, unit } = block.data;
  return (
    <>
      <label htmlFor={`block-${block.id}-amount`} className={LABEL_CLASS}>
        Quanto tempo esperar
      </label>
      <div className="flex items-center gap-2">
        <NumberField
          id={`block-${block.id}-amount`}
          className={`${INPUT_CLASS} w-24`}
          value={amount}
          min={1}
          max={maxAmountFor(unit)}
          onCommit={(value) => update({ ...block, data: { amount: value, unit } })}
          ariaLabel="Quanto tempo esperar"
        />
        <select
          className={INPUT_CLASS}
          value={unit}
          aria-label="Unidade de tempo"
          onChange={(e) => {
            const next = e.target.value as WaitUnit;
            update({ ...block, data: { unit: next, amount: Math.min(amount, maxAmountFor(next)) } });
          }}
        >
          {(Object.keys(WAIT_UNIT_LABELS) as WaitUnit[]).map((u) => (
            <option key={u} value={u}>
              {WAIT_UNIT_LABELS[u]}
            </option>
          ))}
        </select>
      </div>
      <p className={HELP_CLASS}>No máximo 7 dias. Depois da espera, o robô segue para o próximo bloco.</p>
    </>
  );
}

// ---------------------------------------------------------------- Esperar resposta

function WaitReplyEditor({ block, update }: EditorProps<'wait_reply'>) {
  return (
    <>
      <label htmlFor={`block-${block.id}-timeout`} className={LABEL_CLASS}>
        Aguardar por (minutos)
      </label>
      <NumberField
        id={`block-${block.id}-timeout`}
        value={block.data.timeout_minutes}
        min={1}
        max={MAX_REPLY_MINUTES}
        onCommit={(timeout_minutes) => update({ ...block, data: { timeout_minutes } })}
        ariaLabel="Minutos aguardando resposta"
      />
      <p className={HELP_CLASS}>
        Até 30 dias (43200 minutos). Se o lead responder, segue pela saída "Respondeu"; sem resposta no prazo, pela
        saída "Sem resposta". As duas saídas ficam no rodapé do balão.
      </p>
    </>
  );
}

// ---------------------------------------------------------------- Condição

function ConditionEditor({ block, update }: EditorProps<'condition'>) {
  const rules = block.data.rules;
  const setRules = (next: ConditionRuleDraft[]) => update({ ...block, data: { rules: next } });
  return (
    <>
      <p className={HELP_CLASS}>
        Compara a última resposta do lead (sem acentos, sem diferenciar maiúsculas). A primeira regra que bater decide o
        caminho; nenhuma batendo, segue pela saída "Senão". Separe as palavras por vírgula; use aspas para palavras com
        vírgula, ex.: "sim, quero".
      </p>
      {rules.map((rule, index) => (
        <div key={rule.id} className="space-y-1">
          <label htmlFor={`block-${block.id}-rule-${rule.id}`} className={LABEL_CLASS}>
            Regra {index + 1}
          </label>
          <div className="flex items-center gap-1">
            <input
              id={`block-${block.id}-rule-${rule.id}`}
              className={INPUT_CLASS}
              value={rule.keywords}
              onChange={(e) => setRules(rules.map((r) => (r.id === rule.id ? { ...r, keywords: e.target.value } : r)))}
              placeholder="sim, quero, pode"
              aria-label={`Palavras-chave da regra ${index + 1} (separadas por vírgula)`}
            />
            <button
              type="button"
              className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-900/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label={`Remover regra ${index + 1}`}
              title={rules.length <= 1 ? 'A condição precisa de ao menos uma regra' : 'Remover regra'}
              disabled={rules.length <= 1}
              onClick={() => setRules(rules.filter((r) => r.id !== rule.id))}
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs font-medium text-purple-600 dark:text-purple-300 hover:underline"
        onClick={() => setRules([...rules, { id: newId(), keywords: '' }])}
      >
        <Plus size={12} aria-hidden="true" />
        Adicionar regra
      </button>
    </>
  );
}

// ---------------------------------------------------------------- Mover etapa, Rótulo, Webhook, Agente, Encerrar

function MoveStageEditor({ block, update }: EditorProps<'move_stage'>) {
  const { options } = useCanvasContext();
  return (
    <>
      <label htmlFor={`block-${block.id}-stage`} className={LABEL_CLASS}>
        Etapa de destino
      </label>
      <StageSelect
        id={`block-${block.id}-stage`}
        value={block.data.stage_id}
        onChange={(stage_id) => update({ ...block, data: { stage_id } })}
        options={options}
        ariaLabel="Etapa de destino"
      />
      <p className={HELP_CLASS}>Sem negócio ligado à conversa, este bloco é pulado.</p>
    </>
  );
}

function TagEditor({ block, update }: EditorProps<'add_tag'>) {
  const { options } = useCanvasContext();
  return (
    <>
      <label htmlFor={`block-${block.id}-tag`} className={LABEL_CLASS}>
        Rótulo
      </label>
      <TagInput
        id={`block-${block.id}-tag`}
        value={block.data.tag}
        onChange={(tag) => update({ ...block, data: { tag } })}
        options={options}
        ariaLabel="Rótulo a adicionar"
      />
      <p className={HELP_CLASS}>Adiciona o rótulo ao negócio da conversa.</p>
    </>
  );
}

function WebhookEditor({ block, update }: EditorProps<'webhook'>) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const { url, secret, body_template } = block.data;

  useEffect(() => {
    autoResize(bodyRef.current);
  }, [body_template]);

  const set = (patch: Partial<typeof block.data>) => update({ ...block, data: { ...block.data, ...patch } });

  return (
    <>
      <label htmlFor={`block-${block.id}-url`} className={LABEL_CLASS}>
        URL
      </label>
      <input
        id={`block-${block.id}-url`}
        type="url"
        className={INPUT_CLASS}
        value={url}
        onChange={(e) => set({ url: e.target.value })}
        placeholder="https://..."
        autoComplete="off"
      />
      <label htmlFor={`block-${block.id}-secret`} className={LABEL_CLASS}>
        Segredo (opcional)
      </label>
      <input
        id={`block-${block.id}-secret`}
        type="password"
        className={INPUT_CLASS}
        value={secret}
        onChange={(e) => set({ secret: e.target.value })}
        placeholder="Enviado no header X-Webhook-Secret"
        autoComplete="off"
        maxLength={200}
      />
      <label htmlFor={`block-${block.id}-body`} className={LABEL_CLASS}>
        Corpo personalizado (opcional)
      </label>
      <textarea
        id={`block-${block.id}-body`}
        ref={bodyRef}
        className={`${INPUT_CLASS} resize-none font-mono text-xs`}
        rows={3}
        value={body_template}
        onChange={(e) => set({ body_template: e.target.value })}
        placeholder={'Ex.: {"telefone": "{{telefone}}"}'}
        maxLength={20000}
      />
      <p className={HELP_CLASS}>POST em JSON. Vazio: envia os dados padrão do lead e do negócio.</p>
    </>
  );
}

type TemplateOption = {
  id: string;
  name: string;
  type: 'general' | 'whatsapp_api';
  meta_status?: string | null;
  body: string;
  buttons?: Array<{ type: string; text: string }> | null;
};

function TemplateEditor({ block, update }: EditorProps<'send_template'>) {
  const templatesQ = useQuery<{ data: TemplateOption[] }>({
    queryKey: ['messageTemplates'],
    queryFn: async () => {
      const res = await fetch('/api/message-templates', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 60000,
  });
  const all = templatesQ.data?.data ?? [];
  const api = all.filter((t) => t.type === 'whatsapp_api');
  const general = all.filter((t) => t.type === 'general');
  const chosen = all.find((t) => t.id === block.data.template_id);
  const pick = (id: string) => {
    const t = all.find((x) => x.id === id);
    // Só botões de resposta rápida viram saídas (link/telefone não geram resposta)
    const buttons = (t?.buttons ?? []).filter((b) => b.type === 'QUICK_REPLY').map((b) => b.text);
    update({ ...block, data: { ...block.data, template_id: id, template_name: t?.name ?? '', buttons } });
  };
  const statusLabel = (status: string | null | undefined) =>
    status === 'APPROVED' ? '' : status === 'REJECTED' ? ' (rejeitado pela Meta)' : ' (aguardando aprovação)';
  return (
    <>
      <label htmlFor={`block-${block.id}-template`} className={LABEL_CLASS}>
        Modelo de mensagem
      </label>
      <select
        id={`block-${block.id}-template`}
        className={INPUT_CLASS}
        value={block.data.template_id}
        onChange={(e) => pick(e.target.value)}
        aria-label="Modelo de mensagem"
      >
        <option value="">{templatesQ.isLoading ? 'Carregando...' : 'Escolha o modelo'}</option>
        {api.length > 0 ? (
          <optgroup label="WhatsApp API (modelos da Meta)">
            {api.map((t) => (
              <option key={t.id} value={t.id} disabled={t.meta_status !== 'APPROVED'}>
                {t.name}
                {statusLabel(t.meta_status)}
              </option>
            ))}
          </optgroup>
        ) : null}
        {general.length > 0 ? (
          <optgroup label="Modelos gerais (vão como texto)">
            {general.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
      {templatesQ.isError ? <p className={HELP_CLASS}>Não foi possível carregar os modelos.</p> : null}
      {!templatesQ.isLoading && all.length === 0 ? (
        <p className={HELP_CLASS}>Nenhum modelo cadastrado. Crie em Configurações → Modelos.</p>
      ) : null}
      {chosen ? (
        <div className="mt-2 rounded-2xl rounded-tl-md bg-[#d9fdd3] dark:bg-[#005c4b] px-3 py-2 text-sm leading-snug text-slate-900 dark:text-white whitespace-pre-wrap">
          {chosen.body}
        </div>
      ) : null}
      {chosen && (chosen.buttons ?? []).length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {(chosen.buttons ?? []).map((b, i) => (
            <span
              key={i}
              className={`px-2 py-0.5 rounded-full text-xs border ${
                b.type === 'QUICK_REPLY'
                  ? 'border-emerald-300 text-emerald-700 dark:border-emerald-500/50 dark:text-emerald-300'
                  : 'border-slate-300 text-slate-500 dark:border-white/20 dark:text-slate-400'
              }`}
            >
              {b.text}
              {b.type === 'QUICK_REPLY' ? '' : b.type === 'URL' ? ' (link)' : ' (telefone)'}
            </span>
          ))}
        </div>
      ) : null}
      {chosen && block.data.buttons.length > 0 ? (
        <p className={HELP_CLASS}>
          Cada botão de resposta rápida vira uma saída do balão (rodapé). Texto livre sai por "Outra resposta".
        </p>
      ) : null}
      <label htmlFor={`block-${block.id}-timeout`} className={`${LABEL_CLASS} mt-3`}>
        Aguardar a resposta por (minutos)
      </label>
      <NumberField
        id={`block-${block.id}-timeout`}
        value={block.data.timeout_minutes}
        min={1}
        max={MAX_REPLY_MINUTES}
        onCommit={(timeout_minutes) => update({ ...block, data: { ...block.data, timeout_minutes } })}
        ariaLabel="Minutos aguardando resposta"
      />
      <p className={HELP_CLASS}>
        Depois de enviar, o robô espera a resposta: botão → saída do botão; outra resposta → "Outra resposta"; sem
        resposta no prazo → "Sem resposta". Modelo do WhatsApp API sai como template de verdade pela Meta (funciona
        fora da janela de 24 h, com os botões aprovados). As variáveis ({'{{contato.nome}}'}, {'{{contato.telefone}}'},{' '}
        {'{{lead.titulo}}'}, {'{{lead.etapa}}'}) são preenchidas pelo contato e pelo negócio. Num número por QR, vai o
        texto já preenchido.
      </p>
    </>
  );
}

function TypingEditor({ block, update }: EditorProps<'typing'>) {
  return (
    <>
      <label htmlFor={`block-${block.id}-typing`} className={LABEL_CLASS}>
        Mostrar "digitando..." por (segundos)
      </label>
      <NumberField
        id={`block-${block.id}-typing`}
        value={block.data.seconds}
        min={1}
        max={60}
        onCommit={(seconds) => update({ ...block, data: { seconds } })}
        ariaLabel="Segundos digitando"
      />
      <p className={HELP_CLASS}>
        O contato vê "digitando..." e o robô espera esse tempo antes do próximo bloco (1 a 60 s). Na API oficial da
        Meta não há presença: vale só a espera.
      </p>
    </>
  );
}

function StartBotEditor({ block, update }: EditorProps<'start_bot'>) {
  const botsQ = useWaBotsList();
  const bots = botsQ.data ?? [];
  return (
    <>
      <label htmlFor={`block-${block.id}-bot`} className={LABEL_CLASS}>
        Robô que começa
      </label>
      <select
        id={`block-${block.id}-bot`}
        className={INPUT_CLASS}
        value={block.data.bot_id}
        aria-label="Robô que começa"
        onChange={(e) => {
          const picked = bots.find((b) => b.id === e.target.value);
          update({ ...block, data: { bot_id: e.target.value, bot_name: picked?.name ?? '' } });
        }}
      >
        <option value="">{botsQ.isLoading ? 'Carregando...' : 'Escolha o robô'}</option>
        {bots.map((b) => (
          <option key={b.id} value={b.id} disabled={!b.enabled}>
            {b.name}
            {b.enabled ? '' : ' (desligado)'}
          </option>
        ))}
      </select>
      <p className={HELP_CLASS}>
        Este robô termina aqui e o outro começa na mesma conversa (mesmo contato e negócio; o contexto adicional vai
        junto). Até 5 robôs em cadeia.
      </p>
    </>
  );
}

function HandoffEditor({ block, update }: EditorProps<'handoff_agent'>) {
  const { agents } = useCanvasContext();
  return (
    <>
      <label htmlFor={`block-${block.id}-agent`} className={LABEL_CLASS}>
        Agente de IA que assume
      </label>
      <AgentSelect
        id={`block-${block.id}-agent`}
        value={block.data.agent_id}
        onChange={(agent_id) => update({ ...block, data: { agent_id } })}
        agents={agents}
        ariaLabel="Agente de IA que assume"
      />
      <p className={HELP_CLASS}>O robô encerra e o agente de IA assume a conversa a partir daqui.</p>
    </>
  );
}

function BlockFields({ block, update }: { block: Block; update: (block: Block) => void }) {
  switch (block.type) {
    case 'send_text':
      return <MessageEditor block={block} update={update} />;
    case 'send_template':
      return <TemplateEditor block={block} update={update} />;
    case 'wait':
      return <WaitEditor block={block} update={update} />;
    case 'typing':
      return <TypingEditor block={block} update={update} />;
    case 'wait_reply':
      return <WaitReplyEditor block={block} update={update} />;
    case 'condition':
      return <ConditionEditor block={block} update={update} />;
    case 'move_stage':
      return <MoveStageEditor block={block} update={update} />;
    case 'add_tag':
      return <TagEditor block={block} update={update} />;
    case 'webhook':
      return <WebhookEditor block={block} update={update} />;
    case 'handoff_agent':
      return <HandoffEditor block={block} update={update} />;
    case 'start_bot':
      return <StartBotEditor block={block} update={update} />;
    case 'end':
      return <p className={HELP_CLASS}>O robô termina aqui. Nada para configurar.</p>;
  }
}

// ---------------------------------------------------------------- Painel

/**
 * Painel do bloco. No desktop é uma coluna à direita do quadro; no celular,
 * uma folha na parte de baixo (por cima do quadro).
 */
export function BlockPanel({ bubble, block, index, update, onClose, onRemove }: BlockPanelProps) {
  const { issues } = useCanvasContext();
  const meta = NODE_META[block.type];
  const issue = issues.byBlock.get(block.id);
  const total = bubble.data.blocks.length;

  return (
    <aside
      role="region"
      aria-label={`Propriedades do bloco ${meta.label}`}
      className="wa-block-panel absolute inset-x-0 bottom-0 z-20 max-h-[65%] flex flex-col rounded-t-2xl border-t border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-2xl md:static md:inset-auto md:max-h-none md:h-full md:w-[340px] md:shrink-0 md:rounded-none md:border-t-0 md:border-l md:shadow-none"
    >
      <div className="flex items-start gap-2 px-3 py-2.5 border-b border-slate-200 dark:border-white/10">
        <BlockIcon type={block.type} size={16} />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">{meta.label}</h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
            Bloco {index + 1} de {total} · {bubbleTitle(bubble.data)}
          </p>
        </div>
        <button type="button" className={BTN_ICON} onClick={onClose} aria-label="Fechar painel do bloco" title="Fechar (Esc)">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
        {issue?.errors.length ? (
          <ul className="rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-700 dark:text-red-300 space-y-0.5 list-disc pl-6">
            {issue.errors.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        ) : null}
        <p className="text-xs text-slate-500 dark:text-slate-400">{meta.hint}.</p>
        <BlockFields key={block.id} block={block} update={update} />
      </div>
      <div className="px-3 py-2 border-t border-slate-200 dark:border-white/10">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
          onClick={onRemove}
        >
          <Trash2 size={12} aria-hidden="true" />
          Remover bloco
        </button>
      </div>
    </aside>
  );
}

export default BlockPanel;
