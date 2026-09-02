'use client';

/**
 * Régua de follow-ups do agente, uma regra por cartão compacto:
 *
 *   Depois de [1] [hora] sem resposta do lead → [Agente envia uma mensagem]
 *
 * A frase é a parte principal; o resto (instrução ao agente ou robô, regra
 * da janela de 24 h) aparece ao expandir o cartão. Ações secundárias
 * (duplicar, excluir) ficam no menu "...".
 */
import React, { useState } from 'react';
import { AlarmClock, Bot, ChevronDown, Copy, MessageSquare, Plus, Trash2 } from 'lucide-react';
import type { AgentFollowup, AgentFollowupKind } from '@/lib/wa-agents/types';
import {
  BTN_SMALL,
  Disclosure,
  HELP_CLASS,
  INPUT_CLASS,
  InfoTip,
  KebabMenu,
  Segmented,
  SettingRow,
  TEXTAREA_CLASS,
  Toggle,
  newId,
} from './ui';

export type FollowupBotOption = { id: string; name: string; enabled: boolean; trigger?: { type?: string } | null };

const MAX_FOLLOWUPS = 10;
const MAX_MINUTES = 43200;

const UNITS: Array<{ value: number; one: string; many: string }> = [
  { value: 1, one: 'minuto', many: 'minutos' },
  { value: 60, one: 'hora', many: 'horas' },
  { value: 1440, one: 'dia', many: 'dias' },
];

function splitMinutes(minutes: number): { amount: number; unit: number } {
  if (minutes % 1440 === 0) return { amount: minutes / 1440, unit: 1440 };
  if (minutes % 60 === 0) return { amount: minutes / 60, unit: 60 };
  return { amount: minutes, unit: 1 };
}

/** "1 hora", "30 minutos", "2 dias". */
export function describeDelay(minutes: number): string {
  const { amount, unit } = splitMinutes(minutes);
  const u = UNITS.find((x) => x.value === unit) ?? UNITS[0];
  return `${amount} ${amount === 1 ? u.one : u.many}`;
}

const KIND_OPTIONS: Array<{ value: AgentFollowupKind; label: string; icon: React.ReactNode }> = [
  { value: 'agent', label: 'Agente envia uma mensagem', icon: <MessageSquare size={13} aria-hidden="true" /> },
  { value: 'bot', label: 'Robô entra em ação', icon: <Bot size={13} aria-hidden="true" /> },
];

function kindLabel(kind: AgentFollowupKind, botName?: string | null): string {
  if (kind === 'bot') return botName ? `Robô "${botName}" entra em ação` : 'Robô entra em ação';
  return 'Agente envia uma mensagem';
}

export function FollowupsEditor({
  value,
  onChange,
  bots,
}: {
  value: AgentFollowup[];
  onChange: (value: AgentFollowup[]) => void;
  bots: FollowupBotOption[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  const update = (id: string, patch: Partial<AgentFollowup>) =>
    onChange(value.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const remove = (id: string) => {
    onChange(value.filter((f) => f.id !== id));
    if (openId === id) setOpenId(null);
  };
  const duplicate = (f: AgentFollowup) => {
    const copy = { ...f, id: newId() };
    const i = value.findIndex((x) => x.id === f.id);
    const next = [...value];
    next.splice(i + 1, 0, copy);
    onChange(next);
    setOpenId(copy.id);
  };
  const add = () => {
    const f: AgentFollowup = {
      id: newId(),
      after_minutes: 60,
      kind: 'agent',
      instruction: '',
      bot_id: null,
      only_in_window: true,
    };
    onChange([...value, f]);
    setOpenId(f.id);
  };

  const followupBots = bots.filter((b) => {
    const t = b.trigger?.type ?? 'manual';
    return t === 'agent_followup' || t === 'manual';
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500 dark:text-slate-400 inline-flex items-center gap-1.5">
          {value.length === 0
            ? 'Sem follow-ups, o agente só volta a falar quando o lead escrever.'
            : `${value.length} ${value.length === 1 ? 'regra' : 'regras'}, em ordem de tempo.`}
          <InfoTip
            label="Como os follow-ups funcionam"
            text="O relógio conta da última mensagem do agente que ficou sem resposta. Cada regra dispara uma vez; quando o lead responde, a régua recomeça. Vale só enquanto o agente está ativo na conversa."
          />
        </p>
        <button type="button" className={BTN_SMALL} onClick={add} disabled={value.length >= MAX_FOLLOWUPS}>
          <Plus size={14} aria-hidden="true" /> Adicionar follow-up
        </button>
      </div>

      {value.length > 0 ? (
        <ul className="space-y-2" aria-label="Follow-ups">
          {value.map((f, i) => {
            const open = openId === f.id;
            const { amount, unit } = splitMinutes(f.after_minutes);
            const bot = followupBots.find((b) => b.id === f.bot_id) ?? bots.find((b) => b.id === f.bot_id);
            const bodyId = `followup-${f.id}-body`;
            const incompleto = f.kind === 'bot' && !f.bot_id;
            return (
              <li
                key={f.id}
                className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-white/20 transition-colors"
              >
                <div className="flex items-start gap-2 p-3">
                  <span className="mt-0.5 p-1.5 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 shrink-0">
                    <AlarmClock size={14} aria-hidden="true" />
                  </span>
                  <button
                    type="button"
                    className="flex-1 min-w-0 text-left rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/30"
                    aria-expanded={open}
                    aria-controls={bodyId}
                    onClick={() => setOpenId(open ? null : f.id)}
                  >
                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      Follow-up {i + 1}
                    </span>
                    <span className="block text-sm text-slate-800 dark:text-slate-200">
                      Depois de{' '}
                      <span className="font-semibold text-slate-900 dark:text-white">{describeDelay(f.after_minutes)}</span>{' '}
                      sem resposta <span className="text-slate-400">→</span>{' '}
                      <span className={`font-semibold ${incompleto ? 'text-amber-700 dark:text-amber-300' : 'text-purple-700 dark:text-purple-300'}`}>
                        {incompleto ? 'Escolha o robô' : kindLabel(f.kind, bot?.name)}
                      </span>
                    </span>
                    {!open && f.kind === 'agent' && f.instruction.trim() ? (
                      <span className="block text-xs text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">{f.instruction}</span>
                    ) : null}
                  </button>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      className={BTN_SMALL}
                      aria-expanded={open}
                      aria-controls={bodyId}
                      onClick={() => setOpenId(open ? null : f.id)}
                    >
                      <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                      {open ? 'Fechar' : 'Editar'}
                    </button>
                    <KebabMenu
                      label={`Mais ações: follow-up ${i + 1}`}
                      items={[
                        {
                          label: 'Duplicar',
                          icon: <Copy size={14} aria-hidden="true" />,
                          disabled: value.length >= MAX_FOLLOWUPS,
                          onSelect: () => duplicate(f),
                        },
                        { label: 'Excluir', icon: <Trash2 size={14} aria-hidden="true" />, danger: true, onSelect: () => remove(f.id) },
                      ]}
                    />
                  </div>
                </div>

                {open ? (
                  <div id={bodyId} className="px-3 pb-3 pt-3 border-t border-slate-100 dark:border-white/5 space-y-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                      <span>Depois de</span>
                      <span className="inline-flex rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800 overflow-hidden focus-within:ring-2 focus-within:ring-purple-500/20 focus-within:border-purple-500">
                        <input
                          type="number"
                          min={1}
                          className="w-16 bg-transparent px-2 py-1.5 text-sm text-slate-900 dark:text-white outline-none text-center"
                          aria-label="Tempo sem resposta"
                          value={amount}
                          onChange={(e) =>
                            update(f.id, {
                              after_minutes: Math.min(MAX_MINUTES, Math.max(1, Math.round(Number(e.target.value) || 1)) * unit),
                            })
                          }
                        />
                        <select
                          className="bg-transparent border-l border-slate-200 dark:border-white/10 px-2 py-1.5 text-sm text-slate-900 dark:text-white outline-none"
                          aria-label="Unidade de tempo"
                          value={unit}
                          onChange={(e) => update(f.id, { after_minutes: Math.min(MAX_MINUTES, amount * Number(e.target.value)) })}
                        >
                          {UNITS.map((u) => (
                            <option key={u.value} value={u.value}>
                              {amount === 1 ? u.one : u.many}
                            </option>
                          ))}
                        </select>
                      </span>
                      <span>sem resposta do lead</span>
                      <span className="text-slate-400">→</span>
                      <Segmented
                        ariaLabel="O que acontece"
                        value={f.kind}
                        onChange={(kind) => update(f.id, { kind })}
                        options={KIND_OPTIONS}
                      />
                    </div>

                    {f.kind === 'agent' ? (
                      <div>
                        <label
                          htmlFor={`followup-${f.id}-instruction`}
                          className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
                        >
                          Instrução ao agente <span className="font-normal text-slate-400">(opcional)</span>
                        </label>
                        <textarea
                          id={`followup-${f.id}-instruction`}
                          className={TEXTAREA_CLASS}
                          rows={2}
                          maxLength={2000}
                          placeholder="Ex.: retome com leveza e lembre a última pergunta; ofereça ajuda para responder por áudio."
                          value={f.instruction}
                          onChange={(e) => update(f.id, { instruction: e.target.value })}
                        />
                      </div>
                    ) : (
                      <div>
                        <label htmlFor={`followup-${f.id}-bot`} className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                          Robô
                        </label>
                        <select
                          id={`followup-${f.id}-bot`}
                          className={INPUT_CLASS}
                          value={f.bot_id ?? ''}
                          onChange={(e) => update(f.id, { bot_id: e.target.value || null })}
                        >
                          <option value="">Escolha o robô</option>
                          {followupBots.map((b) => (
                            <option key={b.id} value={b.id} disabled={!b.enabled}>
                              {b.name}
                              {b.enabled ? '' : ' (desligado)'}
                            </option>
                          ))}
                        </select>
                        <p className={HELP_CLASS}>
                          Robôs com gatilho &quot;Follow-up do agente de IA&quot; ou &quot;Manual&quot;. O robô roda sem parar o agente; a
                          resposta do lead volta para o agente.
                        </p>
                      </div>
                    )}

                    {f.kind === 'agent' ? (
                      <Disclosure label="Configurações avançadas" defaultOpen={!f.only_in_window}>
                        <div className="rounded-lg border border-slate-200 dark:border-white/10 p-3">
                          <SettingRow
                            title="Só dentro da janela de 24 h da API oficial"
                            tip="Vale para números da API oficial (Meta). Fora da janela de 24 h a regra é pulada. Para reabrir a janela, use uma regra com robô e um Modelo de mensagem."
                            control={
                              <Toggle
                                checked={f.only_in_window}
                                onChange={(only_in_window) => update(f.id, { only_in_window })}
                                label="Só dentro da janela de 24 h"
                              />
                            }
                          />
                        </div>
                      </Disclosure>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export default FollowupsEditor;
