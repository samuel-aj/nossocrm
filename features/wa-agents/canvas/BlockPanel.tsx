'use client';

/**
 * Painel de propriedades do bloco apontado no quadro: gaveta lateral no
 * desktop e folha inferior no celular. Os campos de cada tipo de bloco moram
 * aqui (o balão só mostra ícone, título e resumo).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { AgentSelect, StageSelect, TagInput } from '../OutcomesEditor';
import { LeadChangesEditor, LossFields } from '../LeadEditors';
import { useWaBotsList } from '../useWaAgents';
import { BTN_ICON, HELP_CLASS, INPUT_CLASS, newId } from '../ui';
import { BlockIcon, NODE_META } from './catalog';
import { TemplateBubble, quickReplyTexts, templateFitsNumbers, useMessageTemplates, type TemplateOption } from './templatePreview';
import { useCanvasContext } from './context';
import { bubbleTitle } from './serialize';
import {
  BOT_VARIABLES,
  CONDITION_FIELD_LABELS,
  CONDITION_OP_LABELS,
  MAX_REPLY_SECONDS,
  MAX_TYPING_SECONDS,
  MAX_WAIT_SECONDS,
  MIN_REPLY_SECONDS,
  WAIT_UNIT_LABELS,
  WAIT_UNIT_SECONDS,
  type Block,
  type BlockOfType,
  type BubbleNode,
  type ConditionClauseDraft,
  type ConditionField,
  type ConditionOp,
  type ConditionRuleDraft,
  type LeadChangeDraft,
  type WaitUnit,
  conditionOpsFor,
  newConditionClause,
  newConditionRule,
  opNeedsValue,
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

/** Quantidade + unidade (segundos, minutos, horas, dias) com o limite aplicado ao total. */
function DurationField({
  id,
  amount,
  unit,
  minSeconds,
  maxSeconds,
  onChange,
  ariaLabel,
}: {
  id: string;
  amount: number;
  unit: WaitUnit;
  minSeconds: number;
  maxSeconds: number;
  onChange: (value: { amount: number; unit: WaitUnit }) => void;
  ariaLabel: string;
}) {
  const maxFor = (u: WaitUnit) => Math.max(1, Math.floor(maxSeconds / WAIT_UNIT_SECONDS[u]));
  const minFor = (u: WaitUnit) => Math.max(1, Math.ceil(minSeconds / WAIT_UNIT_SECONDS[u]));
  return (
    <div className="flex items-center gap-2">
      <NumberField
        id={id}
        className={`${INPUT_CLASS} w-24`}
        value={amount}
        min={minFor(unit)}
        max={maxFor(unit)}
        onCommit={(value) => onChange({ amount: value, unit })}
        ariaLabel={ariaLabel}
      />
      <select
        className={INPUT_CLASS}
        value={unit}
        aria-label={`${ariaLabel} (unidade)`}
        onChange={(e) => {
          const next = e.target.value as WaitUnit;
          onChange({ unit: next, amount: Math.max(minFor(next), Math.min(amount, maxFor(next))) });
        }}
      >
        {(Object.keys(WAIT_UNIT_LABELS) as WaitUnit[]).map((u) => (
          <option key={u} value={u}>
            {WAIT_UNIT_LABELS[u]}
          </option>
        ))}
      </select>
    </div>
  );
}

/** "Digitando..." antes da mensagem, no próprio bloco. */
function TypingBeforeField({ id, seconds, onChange }: { id: string; seconds: number; onChange: (seconds: number) => void }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-white/10 p-2 space-y-1">
      <label htmlFor={id} className={LABEL_CLASS}>
        Mostrar "digitando..." antes de enviar
      </label>
      <div className="flex items-center gap-2">
        <NumberField id={id} className={`${INPUT_CLASS} w-24`} value={seconds} min={0} max={MAX_TYPING_SECONDS} onCommit={onChange} ariaLabel="Segundos digitando antes de enviar" />
        <span className="text-xs text-slate-500 dark:text-slate-400">segundos (0 = envia na hora)</span>
      </div>
      <p className={HELP_CLASS}>
        O contato vê "digitando..." por esse tempo e só então a mensagem sai. Vale só para esta mensagem. Na API oficial da
        Meta o aviso aparece depois que o contato já escreveu; o tempo de espera vale sempre.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- Mensagem

function MessageEditor({ block, update }: EditorProps<'send_text'>) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const text = block.data.text;

  useEffect(() => {
    autoResize(textRef.current);
  }, [text]);

  const setText = (value: string) => update({ ...block, data: { ...block.data, text: value } });

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
            className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-colors"
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
      <TypingBeforeField
        id={`block-${block.id}-typing`}
        seconds={block.data.typing_seconds}
        onChange={(typing_seconds) => update({ ...block, data: { ...block.data, typing_seconds } })}
      />
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
      <p className={HELP_CLASS}>No máximo 30 dias. Depois da espera, o robô segue para o próximo bloco.</p>
    </>
  );
}

// ---------------------------------------------------------------- Esperar resposta

function WaitReplyEditor({ block, update }: EditorProps<'wait_reply'>) {
  return (
    <>
      <label htmlFor={`block-${block.id}-timeout`} className={LABEL_CLASS}>
        Aguardar a resposta por
      </label>
      <DurationField
        id={`block-${block.id}-timeout`}
        amount={block.data.amount}
        unit={block.data.unit}
        minSeconds={MIN_REPLY_SECONDS}
        maxSeconds={MAX_REPLY_SECONDS}
        onChange={(value) => update({ ...block, data: value })}
        ariaLabel="Prazo para a resposta"
      />
      <p className={HELP_CLASS}>
        De 30 segundos a 30 dias (o prazo é conferido a cada 30 segundos). Se o lead responder, segue pela saída
        "Respondeu"; sem resposta no prazo, pela saída "Sem resposta". As duas saídas ficam no rodapé do balão.
      </p>
    </>
  );
}

// ---------------------------------------------------------------- Condição

const SMALL_BTN =
  'p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-900/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors';

function ConditionEditor({ block, update }: EditorProps<'condition'>) {
  const { options } = useCanvasContext();
  const boards = options?.boards ?? [];
  const rules = block.data.rules;
  const setRules = (next: ConditionRuleDraft[]) => update({ ...block, data: { rules: next } });
  const setRule = (id: string, patch: Partial<ConditionRuleDraft>) =>
    setRules(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const setClause = (ruleId: string, clauseId: string, patch: Partial<ConditionClauseDraft>) =>
    setRules(
      rules.map((r) =>
        r.id === ruleId ? { ...r, clauses: r.clauses.map((c) => (c.id === clauseId ? { ...c, ...patch } : c)) } : r
      )
    );
  const changeField = (ruleId: string, clause: ConditionClauseDraft, field: ConditionField) => {
    const ops = conditionOpsFor(field);
    setClause(ruleId, clause.id, { field, op: ops.includes(clause.op) ? clause.op : ops[0], value: '', key: '' });
  };

  const valueInput = (rule: ConditionRuleDraft, clause: ConditionClauseDraft, index: number) => {
    const id = `block-${block.id}-${rule.id}-${clause.id}-value`;
    const label = `Valor da condição ${index + 1}`;
    if (clause.field === 'stage') {
      return (
        <StageSelect id={id} value={clause.value} onChange={(value) => setClause(rule.id, clause.id, { value })} options={options} ariaLabel={label} />
      );
    }
    if (clause.field === 'board') {
      return (
        <select id={id} className={INPUT_CLASS} value={clause.value} aria-label={label} onChange={(e) => setClause(rule.id, clause.id, { value: e.target.value })}>
          <option value="">Escolha o quadro</option>
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      );
    }
    if (clause.field === 'tags') {
      return <TagInput id={id} value={clause.value} onChange={(value) => setClause(rule.id, clause.id, { value })} options={options} ariaLabel={label} />;
    }
    return (
      <input
        id={id}
        className={INPUT_CLASS}
        type={clause.field === 'deal_value' ? 'number' : 'text'}
        step={clause.field === 'deal_value' ? 'any' : undefined}
        value={clause.value}
        placeholder={clause.field === 'reply' ? 'ex.: sim' : 'valor'}
        aria-label={label}
        onChange={(e) => setClause(rule.id, clause.id, { value: e.target.value })}
      />
    );
  };

  return (
    <>
      <p className={HELP_CLASS}>
        Cada caminho vira uma saída do balão. O primeiro caminho cujas condições baterem decide; nenhum batendo, segue por
        "Senão". Textos são comparados sem acentos e sem diferenciar maiúsculas; rótulo, etapa, valor e campos vêm do
        negócio ligado à conversa.
      </p>
      {rules.map((rule, index) => (
        <div key={rule.id} className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-2 space-y-2">
          <div className="flex items-center gap-1">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 shrink-0">Caminho {index + 1}</span>
            <input
              className={`${INPUT_CLASS} flex-1 min-w-0`}
              value={rule.label}
              maxLength={60}
              placeholder="Nome da saída (opcional)"
              aria-label={`Nome do caminho ${index + 1}`}
              onChange={(e) => setRule(rule.id, { label: e.target.value })}
            />
            <button
              type="button"
              className={SMALL_BTN}
              aria-label={`Remover caminho ${index + 1}`}
              title={rules.length <= 1 ? 'A condição precisa de ao menos um caminho' : 'Remover caminho'}
              disabled={rules.length <= 1}
              onClick={() => setRules(rules.filter((r) => r.id !== rule.id))}
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </div>
          {rule.clauses.map((clause, ci) => (
            <div key={clause.id} className="space-y-1">
              {ci > 0 ? (
                <div className="flex items-center gap-2">
                  <span className="flex-1 border-t border-slate-200 dark:border-white/10" />
                  <button
                    type="button"
                    className="px-2 py-0.5 rounded-full border border-primary-300 dark:border-primary-500/40 text-[11px] font-bold text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/20"
                    title="Alterna entre E (todas as condições) e OU (qualquer uma)"
                    aria-label={`Combinação das condições do caminho ${index + 1}: ${rule.match === 'all' ? 'todas (E)' : 'qualquer uma (OU)'}`}
                    onClick={() => setRule(rule.id, { match: rule.match === 'all' ? 'any' : 'all' })}
                  >
                    {rule.match === 'all' ? 'E' : 'OU'}
                  </button>
                  <span className="flex-1 border-t border-slate-200 dark:border-white/10" />
                </div>
              ) : null}
              <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-1">
                <div className="flex flex-wrap items-center gap-1">
                  <select
                    className={`${INPUT_CLASS} w-44`}
                    value={clause.field}
                    aria-label={`Campo da condição ${ci + 1}`}
                    onChange={(e) => changeField(rule.id, clause, e.target.value as ConditionField)}
                  >
                    {(Object.keys(CONDITION_FIELD_LABELS) as ConditionField[]).map((f) => (
                      <option key={f} value={f}>
                        {CONDITION_FIELD_LABELS[f]}
                      </option>
                    ))}
                  </select>
                  {clause.field === 'custom_field' ? (
                    <input
                      className={`${INPUT_CLASS} w-40`}
                      value={clause.key}
                      placeholder="chave (ex.: utm_source)"
                      aria-label={`Chave do campo personalizado da condição ${ci + 1}`}
                      onChange={(e) => setClause(rule.id, clause.id, { key: e.target.value })}
                    />
                  ) : null}
                  <select
                    className={`${INPUT_CLASS} w-36`}
                    value={clause.op}
                    aria-label={`Operador da condição ${ci + 1}`}
                    onChange={(e) => setClause(rule.id, clause.id, { op: e.target.value as ConditionOp })}
                  >
                    {conditionOpsFor(clause.field).map((op) => (
                      <option key={op} value={op}>
                        {CONDITION_OP_LABELS[op]}
                      </option>
                    ))}
                  </select>
                  {opNeedsValue(clause.op) ? <div className="flex-1 min-w-[10rem]">{valueInput(rule, clause, ci)}</div> : null}
                </div>
                <button
                  type="button"
                  className={`${SMALL_BTN} self-center`}
                  aria-label={`Remover condição ${ci + 1} do caminho ${index + 1}`}
                  title={rule.clauses.length <= 1 ? 'O caminho precisa de ao menos uma condição' : 'Remover condição'}
                  disabled={rule.clauses.length <= 1}
                  onClick={() => setRule(rule.id, { clauses: rule.clauses.filter((c) => c.id !== clause.id) })}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-300 hover:underline"
            onClick={() => setRule(rule.id, { clauses: [...rule.clauses, newConditionClause(newId())] })}
          >
            <Plus size={12} aria-hidden="true" />
            Adicionar condição ({rule.match === 'all' ? 'E' : 'OU'})
          </button>
        </div>
      ))}
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-300 hover:underline"
        onClick={() => setRules([...rules, newConditionRule(newId(), newId())])}
      >
        <Plus size={12} aria-hidden="true" />
        Adicionar caminho
      </button>
    </>
  );
}

// ---------------------------------------------------------------- Mover etapa, Rótulo, Webhook, Agente, Encerrar

function MoveStageEditor({ block, update }: EditorProps<'move_stage'>) {
  const { options } = useCanvasContext();
  const board = (options?.boards ?? []).find((b) => b.stages.some((s) => s.id === block.data.stage_id));
  const isLoss = !!board?.lost_stage_id && board.lost_stage_id === block.data.stage_id;
  return (
    <>
      <label htmlFor={`block-${block.id}-stage`} className={LABEL_CLASS}>
        Etapa de destino
      </label>
      <StageSelect
        id={`block-${block.id}-stage`}
        value={block.data.stage_id}
        onChange={(stage_id) => {
          // o pipeline da etapa vai junto: etapa de outro pipeline move o lead de pipeline
          const owner = (options?.boards ?? []).find((b) => b.stages.some((s) => s.id === stage_id));
          const lost = !!owner?.lost_stage_id && owner.lost_stage_id === stage_id;
          update({
            ...block,
            data: {
              ...block.data,
              stage_id,
              board_id: owner?.id ?? '',
              ...(lost ? {} : { loss_reason: '', loss_category: '' as const }),
            },
          });
        }}
        options={options}
        ariaLabel="Etapa de destino"
      />
      {isLoss ? (
        <LossFields
          idPrefix={`block-${block.id}-loss`}
          category={block.data.loss_category}
          reason={block.data.loss_reason}
          onChange={(patch) =>
            update({
              ...block,
              data: {
                ...block.data,
                ...(patch.category !== undefined ? { loss_category: patch.category } : {}),
                ...(patch.reason !== undefined ? { loss_reason: patch.reason.slice(0, 200) } : {}),
              },
            })
          }
        />
      ) : null}
      <p className={HELP_CLASS}>
        Etapa de outro pipeline muda o lead de pipeline. Sem lead ligado à conversa, o bloco é pulado e isso aparece no
        histórico da execução.
      </p>
    </>
  );
}

function TagEditor({ block, update }: { block: BlockOfType<'add_tag'> | BlockOfType<'remove_tag'>; update: (block: Block) => void }) {
  const { options } = useCanvasContext();
  const removing = block.type === 'remove_tag';
  return (
    <>
      <label htmlFor={`block-${block.id}-tag`} className={LABEL_CLASS}>
        {removing ? 'Tag a remover' : 'Tag a adicionar'}
      </label>
      <TagInput
        id={`block-${block.id}-tag`}
        value={block.data.tag}
        onChange={(tag) => update({ ...block, data: { tag } } as Block)}
        options={options}
        ariaLabel={removing ? 'Tag a remover' : 'Tag a adicionar'}
      />
      <p className={HELP_CLASS}>
        {removing
          ? 'Tira a tag do lead da conversa. Se ele não tiver a tag, o robô segue normalmente.'
          : 'Adiciona a tag ao lead da conversa (sem repetir).'}
      </p>
    </>
  );
}

function LeadChangesField({
  block,
  update,
  createMode,
}: {
  block: BlockOfType<'create_lead'> | BlockOfType<'update_lead'>;
  update: (block: Block) => void;
  createMode: boolean;
}) {
  const { options } = useCanvasContext();
  return (
    <LeadChangesEditor<LeadChangeDraft>
      rows={block.data.changes}
      onChange={(changes) => update({ ...block, data: { ...block.data, changes } } as Block)}
      makeRow={(row) => ({ ...row, id: newId() })}
      options={options}
      idPrefix={`block-${block.id}-change`}
      createMode={createMode}
    />
  );
}

function CreateLeadEditor({ block, update }: EditorProps<'create_lead'>) {
  const { options } = useCanvasContext();
  const boards = options?.boards ?? [];
  const board = boards.find((b) => b.id === block.data.board_id);
  return (
    <>
      <label htmlFor={`block-${block.id}-board`} className={LABEL_CLASS}>
        Pipeline
      </label>
      <select
        id={`block-${block.id}-board`}
        className={INPUT_CLASS}
        value={block.data.board_id}
        onChange={(e) => {
          const next = boards.find((b) => b.id === e.target.value);
          update({ ...block, data: { ...block.data, board_id: e.target.value, stage_id: next?.stages[0]?.id ?? '' } });
        }}
      >
        <option value="">Escolha o pipeline</option>
        {boards.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <label htmlFor={`block-${block.id}-stage`} className={LABEL_CLASS}>
        Etapa inicial
      </label>
      <select
        id={`block-${block.id}-stage`}
        className={INPUT_CLASS}
        value={block.data.stage_id}
        disabled={!board}
        onChange={(e) => update({ ...block, data: { ...block.data, stage_id: e.target.value } })}
      >
        <option value="">{board ? 'Escolha a etapa' : 'Escolha o pipeline primeiro'}</option>
        {(board?.stages ?? []).map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <p className={HELP_CLASS}>
        O contato é identificado pelo telefone (com e sem o nono dígito). Se ele já tiver um lead aberto, nada é criado e
        o robô segue usando esse lead.
      </p>
      <p className={`${LABEL_CLASS} pt-1`}>Dados iniciais (opcional)</p>
      <LeadChangesField block={block} update={update} createMode />
    </>
  );
}

function UpdateLeadEditor({ block, update }: EditorProps<'update_lead'>) {
  return (
    <>
      <p className={HELP_CLASS}>Sem lead ligado à conversa, o bloco é pulado e isso aparece no histórico da execução.</p>
      <LeadChangesField block={block} update={update} createMode={false} />
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

function TemplateEditor({ block, update }: EditorProps<'send_template'>) {
  const { botConnectionIds, options } = useCanvasContext();
  const templatesQ = useMessageTemplates();
  const all: TemplateOption[] = templatesQ.data?.data ?? [];
  const general = all.filter(t => t.type === 'general');
  const apiGroups = [...new Set(all.filter(t => t.type === 'whatsapp_api').map(t => t.connection_id ?? ''))].map(id => {
    const connection = options?.connections.find(c => c.id === id);
    const label = connection ? [connection.phone_number, connection.name || connection.label].filter(Boolean).join(' · ') : id ? 'Número indisponível' : 'Sem número vinculado';
    return { id, label, templates: all.filter(t => t.type === 'whatsapp_api' && (t.connection_id ?? '') === id) };
  });
  const chosen = all.find((t) => t.id === block.data.template_id);
  const pick = (id: string) => {
    const t = all.find((x) => x.id === id);
    // Só botões de resposta rápida viram saídas (link/telefone não geram resposta)
    const buttons = quickReplyTexts(t);
    update({ ...block, data: { ...block.data, template_id: id, template_name: t?.name ?? '', template_body: t?.body ?? '', buttons } });
  };
  const buttonsChanged = !!chosen && quickReplyTexts(chosen).join('\u0000') !== block.data.buttons.join('\u0000');
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
        {apiGroups.map(group => (
          <optgroup key={group.id} label={`WhatsApp API — ${group.label}`}>
            {group.templates.map(t => (
              <option key={t.id} value={t.id} disabled={t.meta_status !== 'APPROVED' || (!!t.header_type && !t.media_id)}>
                {t.name} — {group.label}{statusLabel(t.meta_status)}{t.header_type && !t.media_id ? ' (mídia faltante)' : ''}
              </option>
            ))}
          </optgroup>
        ))}
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
      {block.data.template_id && templatesQ.data && !chosen ? (
        <p className="rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-900/20 px-2 py-1.5 text-xs text-red-700 dark:text-red-300">
          O modelo "{block.data.template_name || 'escolhido'}" não existe mais. Escolha outro.
        </p>
      ) : null}
      {chosen && !templateFitsNumbers(chosen, botConnectionIds ?? []) && (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          Para ativar este robô, selecione somente o número ao qual este modelo de API pertence.
        </p>
      )}
      {chosen ? (
        <div className="mt-2">
          <p className="mb-1 text-[11px] text-slate-500 dark:text-slate-400">Prévia (variáveis com dados de exemplo)</p>
          <TemplateBubble body={chosen.body} buttons={chosen.buttons ?? []} />
        </div>
      ) : block.data.template_body ? (
        <div className="mt-2">
          <TemplateBubble body={block.data.template_body} buttons={block.data.buttons.map((text) => ({ type: 'QUICK_REPLY', text }))} />
        </div>
      ) : null}
      {buttonsChanged ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-900/20 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-200">
          <span className="flex-1">Os botões deste modelo mudaram desde que ele foi escolhido.</span>
          <button type="button" className="font-semibold underline" onClick={() => chosen && pick(chosen.id)}>
            Atualizar do modelo
          </button>
        </div>
      ) : null}
      {chosen && block.data.buttons.length > 0 ? (
        <p className={HELP_CLASS}>
          Cada botão de resposta rápida vira uma saída do balão (rodapé). Texto livre sai por "Outra resposta".
        </p>
      ) : null}
      <label htmlFor={`block-${block.id}-timeout`} className={`${LABEL_CLASS} mt-3`}>
        Aguardar a resposta por
      </label>
      <DurationField
        id={`block-${block.id}-timeout`}
        amount={block.data.amount}
        unit={block.data.unit}
        minSeconds={MIN_REPLY_SECONDS}
        maxSeconds={MAX_REPLY_SECONDS}
        onChange={(value) => update({ ...block, data: { ...block.data, ...value } })}
        ariaLabel="Prazo para a resposta"
      />
      <TypingBeforeField
        id={`block-${block.id}-typing`}
        seconds={block.data.typing_seconds}
        onChange={(typing_seconds) => update({ ...block, data: { ...block.data, typing_seconds } })}
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
    case 'activate_alert':
      return <label className="grid gap-2 text-sm">Texto do alerta<input className="rounded-lg border p-2 dark:bg-slate-900" value={block.data.message} maxLength={300} onChange={e => update({ ...block, data: { message: e.target.value } })} /></label>;
    case 'add_tag':
    case 'remove_tag':
      return <TagEditor block={block} update={update} />;
    case 'create_lead':
      return <CreateLeadEditor block={block} update={update} />;
    case 'update_lead':
      return <UpdateLeadEditor block={block} update={update} />;
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
      className="wa-block-panel absolute inset-x-0 bottom-0 z-20 max-h-[65%] flex flex-col rounded-t-2xl border-t border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card shadow-2xl md:static md:inset-auto md:max-h-none md:h-full md:w-[340px] md:shrink-0 md:rounded-none md:border-t-0 md:border-l md:shadow-none"
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
