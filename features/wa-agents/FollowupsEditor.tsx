'use client';

/**
 * Régua de follow-ups do agente: "depois de N (min/h/dias) sem resposta do lead →
 * o agente manda uma mensagem (com instrução opcional) ou inicia um robô".
 */
import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { AgentFollowup, AgentFollowupKind } from '@/lib/wa-agents/types';
import { BTN_ICON, BTN_SMALL, HELP_CLASS, INPUT_CLASS, TEXTAREA_CLASS, newId } from './ui';

export type FollowupBotOption = { id: string; name: string; enabled: boolean; trigger?: { type?: string } | null };

const UNITS: Array<{ value: number; label: string }> = [
  { value: 1, label: 'minutos' },
  { value: 60, label: 'horas' },
  { value: 1440, label: 'dias' },
];

function splitMinutes(minutes: number): { amount: number; unit: number } {
  if (minutes % 1440 === 0) return { amount: minutes / 1440, unit: 1440 };
  if (minutes % 60 === 0) return { amount: minutes / 60, unit: 60 };
  return { amount: minutes, unit: 1 };
}

const ROW_CLASS = 'rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-3 space-y-2';

export function FollowupsEditor({
  value,
  onChange,
  bots,
}: {
  value: AgentFollowup[];
  onChange: (value: AgentFollowup[]) => void;
  bots: FollowupBotOption[];
}) {
  const update = (id: string, patch: Partial<AgentFollowup>) =>
    onChange(value.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const remove = (id: string) => onChange(value.filter((f) => f.id !== id));
  const add = () =>
    onChange([
      ...value,
      { id: newId(), after_minutes: 60, kind: 'agent', instruction: '', bot_id: null, only_in_window: true },
    ]);
  const followupBots = bots.filter((b) => {
    const t = b.trigger?.type ?? 'manual';
    return t === 'agent_followup' || t === 'manual';
  });

  return (
    <div className="space-y-3">
      {value.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Nenhum follow-up. Sem regras, o agente só volta a falar quando o lead escrever.
        </p>
      ) : null}
      {value.map((f, i) => {
        const { amount, unit } = splitMinutes(f.after_minutes);
        return (
          <div key={f.id} className={ROW_CLASS}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{i + 1}.</span>
              <span className="text-sm text-slate-700 dark:text-slate-300">Depois de</span>
              <input
                type="number"
                min={1}
                className={`${INPUT_CLASS} w-20`}
                aria-label="Tempo sem resposta"
                value={amount}
                onChange={(e) =>
                  update(f.id, { after_minutes: Math.min(43200, Math.max(1, Math.round(Number(e.target.value) || 1)) * unit) })
                }
              />
              <select
                className={`${INPUT_CLASS} w-28`}
                aria-label="Unidade de tempo"
                value={unit}
                onChange={(e) => update(f.id, { after_minutes: Math.min(43200, amount * Number(e.target.value)) })}
              >
                {UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
              <span className="text-sm text-slate-700 dark:text-slate-300">sem resposta do lead</span>
              <select
                className={`${INPUT_CLASS} flex-1 min-w-[14rem]`}
                aria-label="O que acontece"
                value={f.kind}
                onChange={(e) => update(f.id, { kind: e.target.value as AgentFollowupKind })}
              >
                <option value="agent">o agente manda uma mensagem</option>
                <option value="bot">um robô entra em ação</option>
              </select>
              <button type="button" className={BTN_ICON} onClick={() => remove(f.id)} aria-label="Remover follow-up" title="Remover">
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>
            {f.kind === 'agent' ? (
              <>
                <textarea
                  className={TEXTAREA_CLASS}
                  rows={2}
                  maxLength={2000}
                  aria-label="Instrução para o agente"
                  placeholder="Instrução para o agente (opcional). Ex.: retome com leveza e lembre a última pergunta; ofereça ajuda para responder por áudio."
                  value={f.instruction}
                  onChange={(e) => update(f.id, { instruction: e.target.value })}
                />
                <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={f.only_in_window}
                    onChange={(e) => update(f.id, { only_in_window: e.target.checked })}
                  />
                  <span>
                    Só dentro da janela de 24 h da API oficial (número Meta). Fora da janela a regra é pulada: use uma
                    regra com robô + Modelo de mensagem.
                  </span>
                </label>
              </>
            ) : (
              <>
                <select
                  className={INPUT_CLASS}
                  aria-label="Robô do follow-up"
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
                  Aparecem os robôs com gatilho "Follow-up do agente de IA" ou "Manual". O robô roda na conversa sem parar o
                  agente: a resposta do lead volta para o agente. Para reabrir a janela da API oficial, use um robô com o
                  bloco Modelo de mensagem.
                </p>
              </>
            )}
          </div>
        );
      })}
      <button type="button" className={BTN_SMALL} onClick={add} disabled={value.length >= 10}>
        <Plus size={14} aria-hidden="true" /> Adicionar follow-up
      </button>
      <p className={HELP_CLASS}>
        O relógio conta da última mensagem do agente que ficou sem resposta. Cada regra dispara uma vez; quando o lead
        responde, a régua recomeça do zero. Vale só enquanto o agente está ativo na conversa (pausado ou parado, nada é
        enviado).
      </p>
    </div>
  );
}

export default FollowupsEditor;
