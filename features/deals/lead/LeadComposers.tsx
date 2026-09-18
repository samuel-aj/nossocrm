'use client';

/**
 * Compositores da tela do lead que NÃO vão para o WhatsApp: nota interna e
 * atividade. Os rascunhos ficam no estado do pai (a tela do lead), então
 * alternar entre Mensagem, Nota e Atividade nunca perde o que foi escrito.
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, Lock } from 'lucide-react';
import type { Activity } from '@/types';

export type ActivityDraft = {
  editingId: string | null;
  type: 'CALL' | 'MEETING' | 'EMAIL' | 'TASK';
  title: string;
  date: string; // yyyy-mm-dd
  time: string; // hh:mm
  description: string;
};

export const EMPTY_ACTIVITY_DRAFT: ActivityDraft = { editingId: null, type: 'TASK', title: '', date: '', time: '', description: '' };

export function draftFromActivity(a: Activity): ActivityDraft {
  const d = new Date(a.date);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    editingId: a.id,
    type: (['CALL', 'MEETING', 'EMAIL', 'TASK'].includes(a.type) ? a.type : 'TASK') as ActivityDraft['type'],
    title: a.title,
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    description: a.description || '',
  };
}

const INPUT =
  'bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60';

export function NoteComposer({
  value,
  onChange,
  onSave,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: (text: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(120, Math.min(el.scrollHeight, 240))}px`;
  }, [value]);
  const save = async () => {
    const text = value.trim();
    if (!text || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(text);
      onChange('');
    } catch (e) {
      setError((e as Error)?.message || 'Não foi possível salvar a nota. O texto continua aqui.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="p-3 pt-2">
      {error && <p role="alert" className="mb-1.5 text-xs text-red-500">{error}</p>}
      <div className="flex flex-col gap-2">
        <textarea
          ref={ref}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void save();
            }
          }}
          rows={4}
          disabled={disabled}
          aria-label="Nota interna"
          placeholder="Escreva uma nota interna. Ela fica só no CRM e não vai para o WhatsApp."
          className="w-full min-h-[120px] resize-none overflow-y-auto rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-900/10 px-3 py-2.5 text-sm leading-relaxed text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={disabled || saving || !value.trim()}
          className="self-end shrink-0 h-10 px-3 inline-flex items-center gap-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold transition-colors"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          Salvar nota
        </button>
      </div>
      <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
        <Lock size={10} aria-hidden="true" /> Visível só para a equipe. Ctrl+Enter salva.
      </p>
    </div>
  );
}

export function ActivityComposer({
  draft,
  onChange,
  onSubmit,
  onCancelEdit,
  onComplete,
  disabled,
}: {
  draft: ActivityDraft;
  onChange: (d: ActivityDraft) => void;
  onSubmit: (d: ActivityDraft) => Promise<void>;
  onCancelEdit: () => void;
  /** Concluir a atividade que está sendo editada */
  onComplete?: (id: string) => Promise<void> | void;
  disabled?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<ActivityDraft>) => onChange({ ...draft, ...patch });
  const valid = !!draft.title.trim() && !!draft.date && !!draft.time;
  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(draft);
    } catch (e) {
      setError((e as Error)?.message || 'Não foi possível salvar a atividade. Os dados continuam aqui.');
    } finally {
      setSaving(false);
    }
  };
  // atalhos de data: hoje / amanhã
  const pad = (n: number) => String(n).padStart(2, '0');
  const dayStr = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  return (
    <div className="p-3 pt-2 space-y-2">
      {draft.editingId && (
        <p className="text-[11px] font-semibold text-primary-700 dark:text-primary-300">
          Editando atividade.{' '}
          <button type="button" onClick={onCancelEdit} className="underline hover:no-underline">
            Cancelar edição
          </button>
        </p>
      )}
      {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2 max-sm:flex-wrap">
        <select
          value={draft.type}
          onChange={e => set({ type: e.target.value as ActivityDraft['type'] })}
          disabled={disabled}
          aria-label="Tipo da atividade"
          className={`${INPUT} w-32 max-sm:w-full`}
        >
          <option value="TASK">Tarefa</option>
          <option value="CALL">Ligação</option>
          <option value="MEETING">Reunião</option>
          <option value="EMAIL">E-mail</option>
        </select>
        <input
          value={draft.title}
          onChange={e => set({ title: e.target.value })}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
          }}
          disabled={disabled}
          aria-label="Título da atividade"
          placeholder="O que precisa ser feito?"
          className={`${INPUT} flex-1 min-w-0`}
        />
      </div>
      <div className="flex gap-2 flex-wrap items-center">
        <input type="date" value={draft.date} onChange={e => set({ date: e.target.value })} disabled={disabled} aria-label="Data" className={`${INPUT} w-[150px]`} />
        <input type="time" value={draft.time} onChange={e => set({ time: e.target.value })} disabled={disabled} aria-label="Hora" className={`${INPUT} w-[110px]`} />
        <button type="button" onClick={() => set({ date: dayStr(0), time: draft.time || '09:00' })} className="text-[11px] font-semibold text-slate-500 hover:text-primary-600 dark:text-slate-400">
          Hoje
        </button>
        <button type="button" onClick={() => set({ date: dayStr(1), time: draft.time || '09:00' })} className="text-[11px] font-semibold text-slate-500 hover:text-primary-600 dark:text-slate-400">
          Amanhã
        </button>
      </div>
      <textarea
        value={draft.description}
        onChange={e => set({ description: e.target.value })}
        disabled={disabled}
        rows={1}
        aria-label="Descrição da atividade"
        placeholder="Descrição (opcional)"
        className={`${INPUT} w-full resize-none`}
      />
      <div className="flex items-center justify-end gap-2">
        {draft.editingId && onComplete && (
          <button
            type="button"
            onClick={() => void onComplete(draft.editingId!)}
            disabled={disabled || saving}
            className="h-9 px-3 rounded-xl border border-emerald-300 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-300 text-sm font-bold hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-50"
          >
            Concluir
          </button>
        )}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={disabled || saving || !valid}
          title={!valid ? 'Preencha título, data e hora' : undefined}
          className="h-9 px-3 inline-flex items-center gap-1.5 rounded-xl bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold transition-colors"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          {draft.editingId ? 'Salvar alterações' : 'Criar atividade'}
        </button>
      </div>
    </div>
  );
}
