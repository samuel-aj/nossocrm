'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Plus, Trash2 } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { FollowupCalendarSchema, type FollowupCalendar } from '@/lib/wa-agents/followupCalendar';

const DAYS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const FIELD = 'rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2 text-sm';
const KEY = ['followupCalendar'];

export function FollowupCalendarSettings() {
  const qc = useQueryClient();
  const { addToast } = useToast();
  const q = useQuery<FollowupCalendar>({ queryKey: KEY, queryFn: async () => {
    const res = await fetch('/api/wa-agents/followup-calendar');
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Falha ao carregar horários');
    return body.calendar;
  } });
  const [draft, setDraft] = useState<FollowupCalendar | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (q.data) setDraft(q.data); }, [q.data]);
  if (q.error) return <p role="alert" className="text-red-600">{q.error.message}</p>;
  if (!draft) return <p>Carregando horários...</p>;
  const validation = FollowupCalendarSchema.safeParse(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(q.data);
  const updateSlot = (index: number, patch: Partial<FollowupCalendar['slots'][number]>) =>
    setDraft({ ...draft, slots: draft.slots.map((slot, i) => i === index ? { ...slot, ...patch } : slot) });
  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/wa-agents/followup-calendar', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Falha ao salvar horários');
      qc.setQueryData(KEY, body.calendar);
      addToast('Horários de follow-up salvos', 'success');
    } catch (error) { addToast(error instanceof Error ? error.message : 'Falha ao salvar', 'error'); }
    finally { setSaving(false); }
  };
  return <section className="max-w-3xl rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 p-6 space-y-6">
    <header className="space-y-2">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><Clock size={20} className="text-primary-600" /> Horários de follow-up</h2>
      <p className="text-sm text-slate-500">Escolha quando a IA e os robôs podem retomar uma conversa sem uma nova mensagem do cliente.</p>
      <p className="text-sm text-slate-500">Se o cliente escrever, a IA responde normalmente, inclusive fora desses horários. Um follow-up que vencer fora do horário aguarda a próxima abertura.</p>
      <p className="text-sm text-slate-500">Com o calendário ligado, se várias regras da IA vencerem durante a pausa, somente a última será executada na retomada.</p>
    </header>
    <label className="flex gap-3 items-center font-medium text-sm">
      <input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />
      Limitar follow-ups aos dias e horários abaixo
    </label>
    <label className="block text-sm space-y-2"> <span className="block">Fuso horário</span>
      <input list="followup-timezones" aria-label="Fuso horário" className={`${FIELD} w-full`} value={draft.timezone} onChange={e => setDraft({ ...draft, timezone: e.target.value })} />
      <datalist id="followup-timezones">{['America/Sao_Paulo', 'America/Manaus', 'America/Cuiaba', 'America/Rio_Branco', 'America/Noronha'].map(tz => <option key={tz} value={tz} />)}</datalist>
    </label>
    <div className="divide-y divide-slate-100 dark:divide-white/10">
      {DAYS.map((name, day) => <div key={day} className="py-3 flex flex-wrap items-start gap-3">
        <span className="w-32 py-2 text-sm font-medium">{name}</span>
        <div className="flex-1 space-y-2">
          {!draft.slots.some(s => s.day === day) && <span className="inline-block py-2 text-sm text-slate-400">Sem follow-ups</span>}
          {draft.slots.map((slot, index) => slot.day === day ? <div key={index} className="flex gap-2 items-center">
            <input type="time" className={FIELD} aria-label={`${name}: início ${index + 1}`} value={slot.start} onChange={e => updateSlot(index, { start: e.target.value })} />
            <span className="text-slate-400">até</span>
            <input type="time" className={FIELD} aria-label={`${name}: fim ${index + 1}`} value={slot.end} onChange={e => updateSlot(index, { end: e.target.value })} />
            <button aria-label={`Remover horário de ${name}`} onClick={() => setDraft({ ...draft, slots: draft.slots.filter((_, i) => i !== index) })}><Trash2 size={16} /></button>
          </div> : null)}
        </div>
        <button className="p-2 text-primary-600" aria-label={`Adicionar horário de ${name}`} disabled={draft.slots.length >= 28} onClick={() => setDraft({ ...draft, slots: [...draft.slots, { day, start: '09:00', end: '18:00' }] })}><Plus size={18} /></button>
      </div>)}
    </div>
    {!validation.success && <p role="alert" className="text-sm text-red-600">{validation.error.issues[0]?.message}</p>}
    <footer className="flex justify-end"><button className="rounded-lg bg-primary-600 px-4 py-2 text-white disabled:opacity-50" disabled={saving || !dirty || !validation.success} onClick={() => void save()}>{saving ? 'Salvando...' : 'Salvar horários'}</button></footer>
  </section>;
}
