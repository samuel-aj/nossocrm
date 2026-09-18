'use client';

/**
 * Seção "Follow-up por inatividade" da janela da etapa: se o lead ficar um
 * período sem mandar mensagem enquanto estiver na etapa, executa um robô ou
 * envia uma mensagem. Salva direto no servidor (independe do "Salvar" do funil);
 * o agendamento de cada lead é feito pelo banco.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Loader2 } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useWaBotsList } from '@/features/wa-agents/useWaAgents';
import { useMessageTemplates } from '@/features/wa-agents/canvas/templatePreview';

type Unit = 'min' | 'h' | 'd';
const UNIT_SECONDS: Record<Unit, number> = { min: 60, h: 3600, d: 86400 };
const UNIT_LABEL: Record<Unit, string> = { min: 'minutos', h: 'horas', d: 'dias' };

type Rule = {
  enabled: boolean;
  delay_seconds: number;
  action_type: 'bot' | 'message';
  bot_id: string | null;
  message: { kind?: 'text' | 'template'; text?: string; template_id?: string } | null;
};

type Draft = {
  enabled: boolean;
  amount: number;
  unit: Unit;
  action: 'bot' | 'message';
  botId: string;
  kind: 'text' | 'template';
  text: string;
  templateId: string;
};

function toDraft(rule: Rule | null): Draft {
  const seconds = rule?.delay_seconds ?? 7200;
  const unit: Unit = seconds % 86400 === 0 ? 'd' : seconds % 3600 === 0 ? 'h' : 'min';
  return {
    enabled: rule?.enabled ?? false,
    amount: Math.max(1, Math.round(seconds / UNIT_SECONDS[unit])),
    unit,
    action: rule?.action_type ?? 'message',
    botId: rule?.bot_id ?? '',
    kind: rule?.message?.kind ?? 'text',
    text: rule?.message?.text ?? '',
    templateId: rule?.message?.template_id ?? '',
  };
}

const FIELD = 'w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none';

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function StageFollowupSection({ stageId, stageSaved }: { stageId: string; stageSaved: boolean }) {
  const { addToast } = useToast();
  const qc = useQueryClient();
  const q = useQuery<{ rule: Rule | null; stats: { pending: number; next_due_at: string | null } | null; pendingMigration?: boolean }>({
    queryKey: ['stageFollowup', stageId],
    enabled: stageSaved,
    queryFn: async () => {
      const res = await fetch(`/api/wa-agents/stage-followups/${stageId}`, { credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      return body;
    },
    retry: false,
  });
  const botsQ = useWaBotsList();
  const templatesQ = useMessageTemplates();
  const [draft, setDraft] = useState<Draft>(() => toDraft(null));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (q.data) setDraft(toDraft(q.data.rule));
  }, [q.data]);

  const saved = useMemo(() => toDraft(q.data?.rule ?? null), [q.data]);
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const seconds = Math.round(draft.amount * UNIT_SECONDS[draft.unit]);
  const problem = !draft.enabled
    ? null
    : !(draft.amount >= 1) || seconds < 60 || seconds > 2592000
      ? 'O tempo vai de 1 minuto a 30 dias'
      : draft.action === 'bot' && !draft.botId
        ? 'Escolha o robô'
        : draft.action === 'message' && draft.kind === 'text' && !draft.text.trim()
          ? 'Escreva a mensagem'
          : draft.action === 'message' && draft.kind === 'template' && !draft.templateId
            ? 'Escolha o modelo'
            : null;

  const save = async () => {
    if (problem) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/wa-agents/stage-followups/${stageId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: draft.enabled,
          delay_seconds: seconds,
          action_type: draft.action,
          bot_id: draft.action === 'bot' ? draft.botId || null : null,
          message:
            draft.action === 'message'
              ? draft.kind === 'template'
                ? { kind: 'template', template_id: draft.templateId || undefined }
                : { kind: 'text', text: draft.text }
              : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || 'Falha ao salvar');
      await qc.invalidateQueries({ queryKey: ['stageFollowup', stageId] });
      addToast(draft.enabled ? 'Follow-up por inatividade salvo' : 'Follow-up por inatividade desligado', 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Falha ao salvar o follow-up', 'error');
    } finally {
      setSaving(false);
    }
  };

  const templates = templatesQ.data?.data ?? [];
  const bots = botsQ.data ?? [];

  return (
    <section className="rounded-xl border border-slate-200 dark:border-white/10 p-3 space-y-3" aria-labelledby={`fu-${stageId}`}>
      <div className="flex items-start gap-2">
        <span className="p-1.5 rounded-lg bg-primary-500/10 text-primary-600 dark:text-primary-400 shrink-0">
          <Clock size={14} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={`fu-${stageId}`} className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Follow-up por inatividade
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Se o lead ficar este período sem enviar uma mensagem enquanto estiver nesta etapa, a ação será executada. Cada
            nova mensagem do lead reinicia a contagem.
          </p>
        </div>
        {stageSaved && q.data && !q.data.pendingMigration ? (
          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300 shrink-0">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary-600"
              checked={draft.enabled}
              onChange={(e) => set({ enabled: e.target.checked })}
            />
            {draft.enabled ? 'Ligado' : 'Desligado'}
          </label>
        ) : null}
      </div>

      {!stageSaved ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">Salve o funil com esta etapa para configurar o follow-up.</p>
      ) : q.isLoading ? (
        <p className="inline-flex items-center gap-1.5 text-xs text-slate-500">
          <Loader2 size={12} className="animate-spin" aria-hidden="true" /> Carregando...
        </p>
      ) : q.error ? (
        <p className="text-xs text-red-600 dark:text-red-400">{(q.error as Error).message}</p>
      ) : q.data?.pendingMigration ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">O follow-up por inatividade ainda não foi instalado nesta conta.</p>
      ) : (
        <>
          {draft.enabled ? (
            <div className="space-y-3">
              <div>
                <label htmlFor={`fu-amount-${stageId}`} className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Tempo sem mensagem do lead
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id={`fu-amount-${stageId}`}
                    type="number"
                    min={1}
                    className={`${FIELD} w-24`}
                    value={draft.amount}
                    onChange={(e) => set({ amount: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                  />
                  <select className={FIELD} value={draft.unit} aria-label="Unidade" onChange={(e) => set({ unit: e.target.value as Unit })}>
                    {(Object.keys(UNIT_LABEL) as Unit[]).map((u) => (
                      <option key={u} value={u}>
                        {UNIT_LABEL[u]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <p className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">O que fazer</p>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Tipo de ação">
                  {(
                    [
                      ['message', 'Enviar uma mensagem'],
                      ['bot', 'Executar um robô'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={draft.action === value}
                      onClick={() => set({ action: value })}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        draft.action === value
                          ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-200'
                          : 'border-slate-200 text-slate-600 dark:border-white/10 dark:text-slate-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {draft.action === 'bot' ? (
                <div>
                  <label htmlFor={`fu-bot-${stageId}`} className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Robô
                  </label>
                  <select id={`fu-bot-${stageId}`} className={FIELD} value={draft.botId} onChange={(e) => set({ botId: e.target.value })}>
                    <option value="">{botsQ.isLoading ? 'Carregando...' : 'Escolha o robô'}</option>
                    {bots.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                        {b.enabled ? '' : ' (desligado)'}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    Se o robô já estiver rodando neste lead, ele não é iniciado de novo.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Tipo de mensagem">
                    {(
                      [
                        ['text', 'Texto'],
                        ['template', 'Modelo de mensagem'],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={draft.kind === value}
                        onClick={() => set({ kind: value })}
                        className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                          draft.kind === value
                            ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-200'
                            : 'border-slate-200 text-slate-600 dark:border-white/10 dark:text-slate-300'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {draft.kind === 'text' ? (
                    <>
                      <textarea
                        className={`${FIELD} resize-y`}
                        rows={3}
                        maxLength={4000}
                        value={draft.text}
                        aria-label="Texto da mensagem"
                        placeholder="Ex.: Oi {{primeiro_nome}}, conseguiu ver a nossa proposta?"
                        onChange={(e) => set({ text: e.target.value })}
                      />
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Variáveis: {'{{nome}}'}, {'{{primeiro_nome}}'}, {'{{telefone}}'}, {'{{negocio.titulo}}'}, {'{{negocio.etapa}}'}. Na
                        API oficial da Meta, texto livre só vai dentro de 24 h da última mensagem do lead: fora disso, use um modelo.
                      </p>
                    </>
                  ) : (
                    <select className={FIELD} value={draft.templateId} aria-label="Modelo de mensagem" onChange={(e) => set({ templateId: e.target.value })}>
                      <option value="">{templatesQ.isLoading ? 'Carregando...' : 'Escolha o modelo'}</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id} disabled={t.type === 'whatsapp_api' && t.meta_status !== 'APPROVED'}>
                          {t.name}
                          {t.type === 'whatsapp_api' ? (t.meta_status === 'APPROVED' ? ' (API oficial)' : ' (aguardando aprovação)') : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Dispara uma única vez por lead nesta etapa: depois de executar, não repete, nem se o lead responder ou voltar
                para a etapa. Mensagens da equipe e de robôs não reiniciam a contagem. Ao ligar, os leads que já estão na
                etapa começam a contar agora.
              </p>
            </div>
          ) : null}

          {q.data?.rule?.enabled && q.data.stats ? (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {q.data.stats.pending === 0
                ? 'Nenhum lead aguardando follow-up nesta etapa agora.'
                : `${q.data.stats.pending} lead(s) aguardando; próximo em ${formatWhen(q.data.stats.next_due_at as string)}.`}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            {problem ? <span className="text-xs text-red-600 dark:text-red-400">{problem}</span> : null}
            <button
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saving || !!problem}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : null}
              Salvar follow-up
            </button>
          </div>
        </>
      )}
    </section>
  );
}
