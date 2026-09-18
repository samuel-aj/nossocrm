'use client';

/**
 * Itens do histórico do lead que entram na conversa, na ordem do tempo:
 * notas internas, atividades, alterações do negócio (com autor e valor anterior
 * e novo) e execuções de automação. Alterações próximas do mesmo autor viram um
 * grupo que expande. Registros antigos sem autor aparecem sem autor.
 */
import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock,
  Mail,
  Pencil,
  Phone,
  Plug,
  Sparkles,
  StickyNote,
  Trash2,
  User,
  Users,
  Zap,
} from 'lucide-react';
import type { Activity, Board, CustomFieldDefinition, Deal, DealView } from '@/types';
import type { ChatTimelineEntry } from '@/features/whatsapp/DealWhatsAppChat';
import type { ActivityMeta, ApiNote, DealEvent, DealHistory } from './useDealHistory';

const DT = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const TIME = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const BRL = (v: unknown) =>
  Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const ACTIVITY_TYPE_LABEL: Record<string, string> = {
  CALL: 'Ligação',
  MEETING: 'Reunião',
  EMAIL: 'E-mail',
  TASK: 'Tarefa',
};

export function ActivityTypeIcon({ type, size = 13 }: { type: string; size?: number }) {
  if (type === 'CALL') return <Phone size={size} aria-hidden="true" />;
  if (type === 'MEETING') return <Users size={size} aria-hidden="true" />;
  if (type === 'EMAIL') return <Mail size={size} aria-hidden="true" />;
  return <CheckCircle2 size={size} aria-hidden="true" />;
}

/** Situação de uma atividade pendente: texto + ícone (nunca só cor). */
export function dueState(dateIso: string, now = Date.now()): 'overdue' | 'today' | 'future' {
  const d = new Date(dateIso);
  if (d.getTime() < now) return 'overdue';
  const n = new Date(now);
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate() ? 'today' : 'future';
}

export function DueBadge({ date, completed }: { date: string; completed: boolean }) {
  if (completed) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
        <Check size={11} aria-hidden="true" /> Concluída
      </span>
    );
  }
  const st = dueState(date);
  if (st === 'overdue') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-600 dark:text-red-400">
        <AlertTriangle size={11} aria-hidden="true" /> Atrasada
      </span>
    );
  }
  if (st === 'today') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-400">
        <Clock size={11} aria-hidden="true" /> Hoje
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 dark:text-slate-400">
      <CalendarClock size={11} aria-hidden="true" /> Agendada
    </span>
  );
}

function actorLabel(e: { actor_kind: string; actor_name: string | null; actor_id: string | null }): { text: string; icon: React.ReactNode } {
  switch (e.actor_kind) {
    case 'user':
      return { text: e.actor_name || 'Usuário', icon: <User size={11} aria-hidden="true" /> };
    case 'bot':
      return { text: e.actor_name ? `Robô ${e.actor_name}` : 'Robô', icon: <Bot size={11} aria-hidden="true" /> };
    case 'agent':
      return { text: e.actor_name ? `Agente de IA ${e.actor_name}` : 'Agente de IA', icon: <Sparkles size={11} aria-hidden="true" /> };
    case 'integration':
      return { text: 'Integração (API)', icon: <Plug size={11} aria-hidden="true" /> };
    default:
      return { text: 'Automático do CRM', icon: <Zap size={11} aria-hidden="true" /> };
  }
}

type Ctx = {
  stageLabel: (id: unknown) => string;
  boardName: (id: unknown) => string;
  memberName: (id: unknown) => string;
  fieldLabel: (key: string) => string;
};

const str = (v: unknown) => (v === null || v === undefined || v === '' ? null : Array.isArray(v) ? v.join(', ') : String(v));

function OldNew({ oldV, newV }: { oldV: string | null; newV: string | null }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={oldV ? 'line-through decoration-slate-400/70 text-slate-500 dark:text-slate-400' : 'italic text-slate-400'}>
        {oldV ?? 'vazio'}
      </span>
      <ArrowRight size={11} className="shrink-0 text-slate-400" aria-label="para" />
      <span className={newV ? 'font-semibold text-slate-800 dark:text-slate-100' : 'italic text-slate-400'}>{newV ?? 'vazio'}</span>
    </span>
  );
}

/** Uma linha legível para cada alteração registrada. */
export function describeEvent(e: DealEvent, c: Ctx): { icon: React.ReactNode; text: React.ReactNode; tone?: 'good' | 'bad' | 'warn' } {
  const d = e.detail ?? {};
  switch (e.kind) {
    case 'created':
      return { icon: <CircleDot size={13} />, text: <>Lead criado na etapa <b>{c.stageLabel(e.new_value)}</b></> };
    case 'stage': {
      const boardChanged = d.old_board_id && d.board_id && d.old_board_id !== d.board_id;
      return {
        icon: <ArrowRight size={13} />,
        text: boardChanged ? (
          <>
            Funil: <OldNew oldV={c.boardName(d.old_board_id)} newV={c.boardName(d.board_id)} /> · Etapa:{' '}
            <OldNew oldV={c.stageLabel(e.old_value)} newV={c.stageLabel(e.new_value)} />
          </>
        ) : (
          <>
            Etapa: <OldNew oldV={c.stageLabel(e.old_value)} newV={c.stageLabel(e.new_value)} />
          </>
        ),
      };
    }
    case 'won':
      return { icon: <CheckCircle2 size={13} />, text: <b>Marcado como ganho</b>, tone: 'good' };
    case 'lost':
      return {
        icon: <AlertTriangle size={13} />,
        tone: 'bad',
        text: (
          <>
            <b>{d.updated ? 'Motivo da perda alterado' : 'Marcado como perdido'}</b>
            {d.category ? ` (${d.category === 'qualified' ? 'qualificado' : 'desqualificado'})` : ''}
            {d.reason ? `: ${String(d.reason)}` : ''}
          </>
        ),
      };
    case 'reopened':
      return { icon: <CircleDot size={13} />, text: <b>Lead reaberto</b> };
    case 'deleted':
      return { icon: <Trash2 size={13} />, text: <b>Lead excluído</b>, tone: 'bad' };
    case 'owner':
      return {
        icon: <User size={13} />,
        text: (
          <>
            Responsável: <OldNew oldV={e.old_value ? c.memberName(e.old_value) : null} newV={e.new_value ? c.memberName(e.new_value) : null} />
          </>
        ),
      };
    case 'value':
      return { icon: <CircleDot size={13} />, text: <>Valor: <OldNew oldV={BRL(e.old_value)} newV={BRL(e.new_value)} /></> };
    case 'title':
      return { icon: <Pencil size={13} />, text: <>Nome do lead: <OldNew oldV={str(e.old_value)} newV={str(e.new_value)} /></> };
    case 'description':
      return { icon: <Pencil size={13} />, text: <DescriptionChange oldV={str(e.old_value)} newV={str(e.new_value)} /> };
    case 'tags': {
      const oldT = new Set((Array.isArray(e.old_value) ? e.old_value : []) as string[]);
      const newT = new Set((Array.isArray(e.new_value) ? e.new_value : []) as string[]);
      const added = [...newT].filter(t => !oldT.has(t));
      const removed = [...oldT].filter(t => !newT.has(t));
      return {
        icon: <CircleDot size={13} />,
        text: (
          <>
            Tags:
            {added.length > 0 && <> adicionou <b>{added.join(', ')}</b></>}
            {added.length > 0 && removed.length > 0 && ';'}
            {removed.length > 0 && <> removeu <b className="line-through decoration-slate-400/70">{removed.join(', ')}</b></>}
          </>
        ),
      };
    }
    case 'custom_field':
      return {
        icon: <Pencil size={13} />,
        text: (
          <>
            {c.fieldLabel(e.field ?? '')}: <OldNew oldV={str(e.old_value)} newV={str(e.new_value)} />
          </>
        ),
      };
    case 'product': {
      const op = String(d.op ?? '');
      const fmt = (v: unknown) => {
        const o = (v ?? {}) as { quantity?: number; price?: number };
        return `${o.quantity ?? 1} × ${BRL(o.price)}`;
      };
      if (op === 'insert') return { icon: <CircleDot size={13} />, text: <>Produto adicionado: <b>{e.field}</b> ({fmt(e.new_value)})</> };
      if (op === 'delete') return { icon: <Trash2 size={13} />, text: <>Produto removido: <b>{e.field}</b> ({fmt(e.old_value)})</> };
      return { icon: <Pencil size={13} />, text: <>Produto <b>{e.field}</b>: <OldNew oldV={fmt(e.old_value)} newV={fmt(e.new_value)} /></> };
    }
    case 'activity_done':
      return { icon: <CheckCircle2 size={13} />, text: <>Atividade concluída: <b>{e.field}</b></>, tone: 'good' };
    case 'activity_reopened':
      return { icon: <CircleDot size={13} />, text: <>Atividade reaberta: <b>{e.field}</b></> };
    case 'activity_rescheduled':
      return {
        icon: <CalendarClock size={13} />,
        text: (
          <>
            Atividade <b>{e.field}</b> remarcada: <OldNew oldV={e.old_value ? DT.format(new Date(String(e.old_value))) : null} newV={e.new_value ? DT.format(new Date(String(e.new_value))) : null} />
          </>
        ),
      };
    case 'activity_deleted': {
      const note = ['NOTE', 'note'].includes(String(d.type ?? ''));
      return {
        icon: <Trash2 size={13} />,
        text: note ? (
          <>Nota interna excluída{str(e.old_value) ? <>: <span className="italic">{str(e.old_value)}</span></> : ''}</>
        ) : (
          <>Atividade excluída: <b>{e.field}</b></>
        ),
      };
    }
    case 'followup': {
      const status = String(e.new_value ?? '');
      if (status === 'done' && d.kind === 'bot_started') return { icon: <Bot size={13} />, text: <b>Follow-up por inatividade: robô iniciado</b>, tone: 'good' };
      if (status === 'done') {
        return {
          icon: <Zap size={13} />,
          tone: 'good',
          text: (
            <>
              <b>Follow-up por inatividade: mensagem enviada</b>
              {d.template ? ` (modelo ${String(d.template)})` : ''}
            </>
          ),
        };
      }
      if (status === 'failed') return { icon: <AlertTriangle size={13} />, tone: 'bad', text: <><b>Follow-up por inatividade falhou</b>{d.error ? `: ${String(d.error)}` : ''}</> };
      return { icon: <Clock size={13} />, tone: 'warn', text: <><b>Follow-up por inatividade não executado</b>{d.reason ? `: ${String(d.reason)}` : ''}</> };
    }
    default:
      return { icon: <CircleDot size={13} />, text: <>{e.kind}</> };
  }
}

function DescriptionChange({ oldV, newV }: { oldV: string | null; newV: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <span>
      Descrição {newV ? (oldV ? 'alterada' : 'adicionada') : 'removida'}{' '}
      <button type="button" onClick={() => setOpen(o => !o)} className="font-semibold text-primary-600 dark:text-primary-400 hover:underline" aria-expanded={open}>
        {open ? 'ocultar' : 'ver'}
      </button>
      {open && (
        <span className="mt-1 block space-y-1 text-left">
          <span className="block whitespace-pre-wrap rounded-md bg-red-50/70 dark:bg-red-900/15 px-2 py-1 line-through decoration-red-300/70">
            {oldV ?? '(vazia)'}
          </span>
          <span className="block whitespace-pre-wrap rounded-md bg-emerald-50/70 dark:bg-emerald-900/15 px-2 py-1">{newV ?? '(vazia)'}</span>
        </span>
      )}
    </span>
  );
}

const TONE: Record<string, string> = {
  good: 'text-emerald-700 dark:text-emerald-400',
  bad: 'text-red-600 dark:text-red-400',
  warn: 'text-amber-700 dark:text-amber-400',
};

function EventLine({ e, ctx }: { e: DealEvent; ctx: Ctx }) {
  const d = describeEvent(e, ctx);
  return (
    <div className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
      <span className={`mt-0.5 shrink-0 ${d.tone ? TONE[d.tone] : 'text-slate-400'}`}>{d.icon}</span>
      <span className="min-w-0 flex-1 break-words">{d.text}</span>
    </div>
  );
}

/** Alterações próximas do mesmo autor: uma linha e "mais N", que expande. */
function EventGroup({ events, ctx }: { events: DealEvent[]; ctx: Ctx }) {
  const [open, setOpen] = useState(false);
  const first = events[0];
  const actor = actorLabel(first);
  const shown = open ? events : events.slice(0, 1);
  return (
    <div className="mx-auto w-full max-w-xl rounded-lg border border-dashed border-slate-200 dark:border-white/10 bg-white/60 dark:bg-white/[0.03] px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        <span className="inline-flex items-center gap-1 normal-case tracking-normal text-[11px] text-slate-500 dark:text-slate-400">
          {actor.icon} {actor.text}
        </span>
        <span aria-hidden="true">·</span>
        <time dateTime={first.created_at} className="normal-case tracking-normal text-[11px]">{TIME.format(new Date(first.created_at))}</time>
        <span className="ml-auto normal-case tracking-normal text-[10px]">Alteração</span>
      </div>
      <div className="space-y-1">
        {shown.map(e => (
          <EventLine key={e.id} e={e} ctx={ctx} />
        ))}
      </div>
      {events.length > 1 && (
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-primary-600 dark:text-primary-400 hover:underline"
        >
          <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          {open ? 'Mostrar menos' : `Mais ${events.length - 1} ${events.length - 1 === 1 ? 'alteração' : 'alterações'}`}
        </button>
      )}
    </div>
  );
}

/** Registro antigo de alteração (antes do histórico com autor): mostrado como estava. */
function LegacyChange({ a }: { a: Activity }) {
  return (
    <div className="mx-auto w-full max-w-xl rounded-lg border border-dashed border-slate-200 dark:border-white/10 bg-white/60 dark:bg-white/[0.03] px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
      <div className="mb-0.5 flex items-center gap-1.5 text-[11px] text-slate-400">
        <time dateTime={a.date}>{TIME.format(new Date(a.date))}</time>
        <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide">Alteração</span>
      </div>
      <p className="break-words">{a.title}</p>
      {a.description && <p className="mt-0.5 break-words text-slate-500 dark:text-slate-400">{a.description}</p>}
    </div>
  );
}

function NoteCard({
  id,
  text,
  at,
  meta,
  canEdit,
  onSave,
  onDelete,
}: {
  id: string;
  text: string;
  at: string;
  meta?: { authorName: string | null; editedAt: string | null; editedByName: string | null } | null;
  canEdit: boolean;
  onSave?: (id: string, text: string) => Promise<void> | void;
  onDelete?: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!onSave || !draft.trim() || draft === text) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(id, draft.trim());
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };
  return (
    <article
      aria-label="Nota interna"
      className="group mx-auto w-full max-w-xl rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-900/15 px-3 py-2.5 shadow-sm"
    >
      <header className="mb-1 flex items-center gap-1.5 text-[11px] text-amber-800/80 dark:text-amber-300/80">
        <StickyNote size={12} aria-hidden="true" />
        <span className="font-bold uppercase tracking-wide text-[10px]">Nota interna</span>
        {meta?.authorName && <span>· {meta.authorName}</span>}
        <span aria-hidden="true">·</span>
        <time dateTime={at}>{TIME.format(new Date(at))}</time>
        {meta?.editedAt && (
          <span title={`Editada em ${DT.format(new Date(meta.editedAt))}${meta.editedByName ? ` por ${meta.editedByName}` : ''}`}>
            · editada
          </span>
        )}
        {canEdit && onSave && !editing && (
          <span className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-100 transition-opacity">
            <button type="button" onClick={() => { setDraft(text); setEditing(true); }} className="p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-500/20" aria-label="Editar nota" title="Editar nota">
              <Pencil size={12} />
            </button>
            {onDelete && (
              <button type="button" onClick={() => onDelete(id)} className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-500/20 hover:text-red-600" aria-label="Excluir nota" title="Excluir nota">
                <Trash2 size={12} />
              </button>
            )}
          </span>
        )}
      </header>
      {editing ? (
        <div data-esc-local="">
          <textarea
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') setEditing(false);
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save();
            }}
            rows={3}
            className="w-full resize-y rounded-lg border border-amber-300 dark:border-amber-500/40 bg-white dark:bg-black/20 px-2 py-1.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-400"
          />
          <div className="mt-1.5 flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} className="px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-amber-100 dark:hover:bg-white/10">
              Cancelar
            </button>
            <button type="button" onClick={() => void save()} disabled={saving || !draft.trim()} className="px-2.5 py-1 rounded-lg text-xs font-bold text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-50">
              {saving ? 'Salvando…' : 'Salvar nota'}
            </button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm text-slate-800 dark:text-slate-100">{text}</p>
      )}
    </article>
  );
}

function ActivityCard({
  a,
  meta,
  onOpen,
  onToggle,
  canEdit,
}: {
  a: Activity;
  meta?: ActivityMeta;
  onOpen: (a: Activity) => void;
  onToggle: (a: Activity) => void;
  canEdit: boolean;
}) {
  return (
    <article
      aria-label={`Atividade: ${a.title}`}
      className="mx-auto w-full max-w-xl rounded-xl border border-primary-200/70 dark:border-primary-500/25 bg-white dark:bg-white/[0.04] px-3 py-2.5 shadow-sm"
    >
      <header className="mb-1 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="text-primary-600 dark:text-primary-400"><ActivityTypeIcon type={a.type} size={12} /></span>
        <span className="font-bold uppercase tracking-wide text-[10px] text-primary-700 dark:text-primary-300">
          {ACTIVITY_TYPE_LABEL[a.type] ?? 'Atividade'} criada
        </span>
        {meta?.authorName && <span>· {meta.authorName}</span>}
        {meta?.createdAt && (
          <>
            <span aria-hidden="true">·</span>
            <time dateTime={meta.createdAt}>{TIME.format(new Date(meta.createdAt))}</time>
          </>
        )}
        <span className="ml-auto"><DueBadge date={a.date} completed={a.completed} /></span>
      </header>
      <div className="flex items-start gap-2">
        {canEdit && (
          <button
            type="button"
            onClick={() => onToggle(a)}
            aria-label={a.completed ? 'Reabrir atividade' : 'Concluir atividade'}
            title={a.completed ? 'Reabrir' : 'Concluir'}
            className={`mt-0.5 h-4 w-4 shrink-0 rounded border flex items-center justify-center ${
              a.completed ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 dark:border-slate-600 hover:border-emerald-500'
            }`}
          >
            {a.completed && <Check size={11} />}
          </button>
        )}
        <button type="button" onClick={() => onOpen(a)} className="min-w-0 flex-1 text-left" title="Abrir atividade">
          <p className={`text-sm font-semibold text-slate-800 dark:text-slate-100 break-words ${a.completed ? 'line-through decoration-slate-400/70' : ''}`}>{a.title}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Para {DT.format(new Date(a.date))}
            {a.assignedToName ? ` · ${a.assignedToName}` : ''}
          </p>
          {a.description && <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300 break-words line-clamp-3">{a.description}</p>}
        </button>
      </div>
    </article>
  );
}

type BuildInput = {
  deal: Deal | DealView;
  activities: Activity[];
  history: DealHistory | undefined;
  boards: Board[];
  memberName: (id: string) => string | null;
  customFields: CustomFieldDefinition[];
  canEdit: boolean;
  onSaveNote: (id: string, text: string) => Promise<void> | void;
  onDeleteNote: (id: string) => void;
  onOpenActivity: (a: Activity) => void;
  onToggleActivity: (a: Activity) => void;
};

const GROUP_WINDOW_MS = 3 * 60 * 1000;

export function useLeadTimelineEntries(input: BuildInput): ChatTimelineEntry[] {
  const { deal, activities, history, boards, memberName, customFields, canEdit, onSaveNote, onDeleteNote, onOpenActivity, onToggleActivity } = input;

  return useMemo(() => {
    const stagesById = new Map<string, string>();
    const boardsById = new Map<string, string>();
    for (const b of boards) {
      boardsById.set(b.id, b.name);
      for (const s of b.stages) stagesById.set(s.id, s.label);
    }
    const fieldsByKey = new Map(customFields.map(f => [f.key, f.label]));
    const ctx: Ctx = {
      stageLabel: id => (id ? stagesById.get(String(id)) ?? 'etapa removida' : 'sem etapa'),
      boardName: id => (id ? boardsById.get(String(id)) ?? 'funil removido' : 'sem funil'),
      memberName: id => memberName(String(id)) ?? 'usuário removido',
      fieldLabel: key =>
        fieldsByKey.get(key) ?? ({ utm_source: 'UTM Source', utm_medium: 'UTM Medium', utm_campaign: 'UTM Campaign', utm_content: 'UTM Content', utm_term: 'UTM Term' } as Record<string, string>)[key] ?? key,
    };

    const out: ChatTimelineEntry[] = [];
    const nowMs = Date.now();
    const meta = history?.activityMeta ?? {};
    const since = history?.available ? (history.since ? Date.parse(history.since) : Infinity) : Infinity;

    for (const a of activities) {
      if (a.type === 'NOTE' || (a.type as string) === 'note') {
        const m = meta[a.id];
        const at = m?.createdAt ?? a.date;
        out.push({
          id: `note:${a.id}`,
          at,
          node: (
            <NoteCard id={a.id} text={a.description || a.title} at={at} meta={m} canEdit={canEdit} onSave={onSaveNote} onDelete={onDeleteNote} />
          ),
        });
      } else if (a.type === 'STATUS_CHANGE') {
        // Com o histórico novo ligado, as alterações vêm dele (com autor); os
        // registros antigos continuam valendo para antes disso.
        if (Date.parse(a.date) >= since) continue;
        out.push({ id: `legacy:${a.id}`, at: a.date, node: <LegacyChange a={a} /> });
      } else {
        const m = meta[a.id];
        // posição = quando foi criada; sem essa informação (recém-criada, ainda
        // sem retorno do servidor), nunca depois de agora
        const at = m?.createdAt ?? (Date.parse(a.date) > nowMs ? new Date(nowMs).toISOString() : a.date);
        out.push({
          id: `act:${a.id}`,
          at,
          node: <ActivityCard a={a} meta={m} onOpen={onOpenActivity} onToggle={onToggleActivity} canEdit={canEdit} />,
        });
      }
    }

    for (const n of history?.apiNotes ?? ([] as ApiNote[])) {
      out.push({
        id: `apinote:${n.id}`,
        at: n.createdAt,
        node: (
          <NoteCard
            id={n.id}
            text={n.content}
            at={n.createdAt}
            meta={{ authorName: n.authorName ?? 'Integração (API)', editedAt: n.updatedAt && n.updatedAt !== n.createdAt ? n.updatedAt : null, editedByName: null }}
            canEdit={false}
          />
        ),
      });
    }

    // Alterações: agrupa as seguidas do mesmo autor em poucos minutos
    const events = history?.events ?? [];
    let group: DealEvent[] = [];
    const flush = () => {
      if (!group.length) return;
      const g = group;
      out.push({ id: `ev:${g[0].id}`, at: g[0].created_at, node: <EventGroup events={g} ctx={ctx} /> });
      group = [];
    };
    for (const e of events) {
      const last = group[group.length - 1];
      const sameAuthor = last && last.actor_kind === e.actor_kind && last.actor_id === e.actor_id;
      const near = last && Date.parse(e.created_at) - Date.parse(group[0].created_at) <= GROUP_WINDOW_MS;
      // automação (follow-up) sempre sozinha: é o que a equipe mais procura
      if (!last || !sameAuthor || !near || e.kind === 'followup' || last.kind === 'followup') flush();
      group.push(e);
    }
    flush();

    // Marco de criação quando o histórico novo ainda não tem o registro
    if (!events.some(e => e.kind === 'created') && deal.createdAt) {
      out.push({
        id: 'created',
        at: deal.createdAt,
        node: (
          <div className="flex justify-center">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-white/10 px-3 py-1 text-[11px] text-slate-500 dark:text-slate-400">
              <CircleDot size={11} aria-hidden="true" /> Lead criado
            </span>
          </div>
        ),
      });
    }
    return out;
  }, [deal.createdAt, activities, history, boards, memberName, customFields, canEdit, onSaveNote, onDeleteNote, onOpenActivity, onToggleActivity]);
}
