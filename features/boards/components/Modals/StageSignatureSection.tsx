'use client';

/**
 * "Assinatura eletrônica" da etapa: ao entrar nela, o CRM cria o documento na
 * ZapSign a partir do modelo escolhido, com as variáveis preenchidas pelos
 * dados do lead, e manda o link. Salva direto no servidor (independe do
 * "Salvar" do funil). Uma vez por lead em cada etapa.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSignature, Loader2 } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useCRM } from '@/context/CRMContext';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { useWaBotsList } from '@/features/wa-agents/useWaAgents';
import { VariableMappingTable } from '@/features/zapsign/VariableMappingTable';
import { AUTH_OPTIONS, DEFAULT_SIGN_MESSAGE, SEND_OPTIONS, useVariableSources, useZapSignTemplateVariables, useZapSignTemplates } from '@/features/zapsign/useZapSign';

type Actions = { stage_id?: string | null; tag?: string | null; bot_id?: string | null };
type Rule = {
  enabled: boolean;
  template_token: string;
  template_name: string | null;
  doc_name: string | null;
  variables: Record<string, string>;
  signer: { auth_mode?: string; require_cpf?: boolean; require_selfie_photo?: boolean; send?: string; message?: string; allow_refuse?: boolean } | null;
  extra_signers: Array<{ name: string; email?: string; phone?: string; qualification?: string }>;
  on_signed: Actions | null;
  on_refused: Actions | null;
};

type Draft = {
  enabled: boolean;
  templateToken: string;
  templateName: string;
  docName: string;
  variables: Record<string, string>;
  authMode: string;
  requireCpf: boolean;
  requireSelfie: boolean;
  send: string;
  message: string;
  allowRefuse: boolean;
  extraName: string;
  extraEmail: string;
  extraPhone: string;
  extraQualification: string;
  signedStage: string;
  signedTag: string;
  signedBot: string;
  refusedStage: string;
  refusedTag: string;
};

function toDraft(rule: Rule | null): Draft {
  const x = rule?.extra_signers?.[0];
  return {
    enabled: rule?.enabled ?? false,
    templateToken: rule?.template_token ?? '',
    templateName: rule?.template_name ?? '',
    docName: rule?.doc_name ?? '',
    variables: rule?.variables ?? {},
    authMode: rule?.signer?.auth_mode ?? 'assinaturaTela',
    requireCpf: rule?.signer?.require_cpf ?? false,
    requireSelfie: rule?.signer?.require_selfie_photo ?? false,
    send: rule?.signer?.send ?? 'crm_whatsapp',
    message: rule?.signer?.message ?? DEFAULT_SIGN_MESSAGE,
    allowRefuse: rule?.signer?.allow_refuse ?? true,
    extraName: x?.name ?? '',
    extraEmail: x?.email ?? '',
    extraPhone: x?.phone ?? '',
    extraQualification: x?.qualification ?? '',
    signedStage: rule?.on_signed?.stage_id ?? '',
    signedTag: rule?.on_signed?.tag ?? '',
    signedBot: rule?.on_signed?.bot_id ?? '',
    refusedStage: rule?.on_refused?.stage_id ?? '',
    refusedTag: rule?.on_refused?.tag ?? '',
  };
}

const FIELD = 'w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none';
const LABEL = 'block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1';

export function StageSignatureSection({ stageId, stageSaved }: { stageId: string; stageSaved: boolean }) {
  const { addToast } = useToast();
  const qc = useQueryClient();
  const { boards } = useCRM();
  const board = useMemo(() => boards.find((b) => b.stages.some((s) => s.id === stageId)) ?? null, [boards, stageId]);
  const q = useQuery<{ rule: Rule | null; stats: { pending: number; signed: number } | null; connected?: boolean; pendingMigration?: boolean }>({
    queryKey: ['stageSignature', stageId],
    enabled: stageSaved,
    queryFn: async () => {
      const res = await fetch(`/api/integrations/zapsign/stage-rules/${stageId}`, { credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      return body;
    },
    retry: false,
  });
  const connected = !!q.data?.connected;
  const templatesQ = useZapSignTemplates(connected);
  const botsQ = useWaBotsList();
  const sources = useVariableSources();
  const [draft, setDraft] = useState<Draft>(() => toDraft(null));
  const [saving, setSaving] = useState(false);
  const varsQ = useZapSignTemplateVariables(connected && draft.templateToken ? draft.templateToken : null);

  useEffect(() => {
    if (q.data) setDraft(toDraft(q.data.rule));
  }, [q.data]);

  // Variáveis novas do modelo entram com a sugestão; as já mapeadas ficam
  useEffect(() => {
    const v = varsQ.data;
    if (!v) return;
    setDraft((d) => {
      const next = { ...d.variables };
      let changed = false;
      for (const name of v.variables) {
        if (!(name in next)) {
          next[name] = v.suggestions[name] ?? '';
          changed = true;
        }
      }
      return changed ? { ...d, variables: next } : d;
    });
  }, [varsQ.data]);

  const saved = useMemo(() => toDraft(q.data?.rule ?? null), [q.data]);
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const variables = varsQ.data?.variables ?? Object.keys(draft.variables);
  const problem = !draft.enabled ? null : !draft.templateToken ? 'Escolha o modelo' : null;

  const save = async () => {
    if (problem) return;
    setSaving(true);
    try {
      const mapping: Record<string, string> = {};
      for (const name of variables) mapping[name] = draft.variables[name] ?? '';
      const res = await fetch(`/api/integrations/zapsign/stage-rules/${stageId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: draft.enabled,
          template_token: draft.templateToken,
          template_name: draft.templateName || null,
          doc_name: draft.docName || null,
          variables: mapping,
          signer: {
            auth_mode: draft.authMode,
            require_cpf: draft.requireCpf,
            require_selfie_photo: draft.requireSelfie,
            send: draft.send,
            message: draft.message,
            allow_refuse: draft.allowRefuse,
          },
          extra_signers: draft.extraName.trim()
            ? [{ name: draft.extraName.trim(), email: draft.extraEmail.trim() || undefined, phone: draft.extraPhone.trim() || undefined, qualification: draft.extraQualification.trim() || undefined }]
            : [],
          on_signed: { stage_id: draft.signedStage || null, tag: draft.signedTag || null, bot_id: draft.signedBot || null },
          on_refused: { stage_id: draft.refusedStage || null, tag: draft.refusedTag || null },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || 'Falha ao salvar');
      await qc.invalidateQueries({ queryKey: ['stageSignature', stageId] });
      addToast(draft.enabled ? 'Envio para assinatura salvo' : 'Envio para assinatura desligado', 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Falha ao salvar', 'error');
    } finally {
      setSaving(false);
    }
  };

  const templates = templatesQ.data?.templates ?? [];
  const stageOptions = board?.stages.filter((s) => s.id !== stageId) ?? [];

  return (
    <section className="rounded-xl border border-slate-200 dark:border-white/10 p-3 space-y-3" aria-labelledby={`sig-${stageId}`}>
      <div className="flex items-start gap-2">
        <span className="p-1.5 rounded-lg bg-primary-500/10 text-primary-600 dark:text-primary-400 shrink-0">
          <FileSignature size={14} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={`sig-${stageId}`} className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Assinatura eletrônica (ZapSign)
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Quando o lead entrar nesta etapa, o CRM monta o documento com os dados dele e manda o link para assinar. Uma vez por
            lead nesta etapa.
          </p>
        </div>
        {stageSaved && q.data && !q.data.pendingMigration && connected ? (
          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300 shrink-0">
            <input type="checkbox" className="h-4 w-4 accent-primary-600" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            {draft.enabled ? 'Ligado' : 'Desligado'}
          </label>
        ) : null}
      </div>

      {!stageSaved ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">Salve o funil com esta etapa para configurar a assinatura.</p>
      ) : q.isLoading ? (
        <p className="inline-flex items-center gap-1.5 text-xs text-slate-500">
          <Loader2 size={12} className="animate-spin" aria-hidden="true" /> Carregando...
        </p>
      ) : q.error ? (
        <p className="text-xs text-red-600 dark:text-red-400">{(q.error as Error).message}</p>
      ) : q.data?.pendingMigration ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">A integração com a ZapSign ainda não foi instalada nesta conta.</p>
      ) : !connected ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Conecte a ZapSign em <a className="underline" href="/settings/integracoes#zapsign">Configurações &gt; Integrações &gt; ZapSign</a> para usar aqui.
        </p>
      ) : (
        <>
          {draft.enabled ? (
            <div className="space-y-4">
              <div>
                <label htmlFor={`sig-tpl-${stageId}`} className={LABEL}>
                  Modelo da ZapSign
                </label>
                <NativeSelect
                  id={`sig-tpl-${stageId}`}
                  className={FIELD}
                  value={draft.templateToken}
                  onChange={(e) => {
                    const t = templates.find((x) => x.token === e.target.value);
                    set({ templateToken: e.target.value, templateName: t?.name ?? '', variables: e.target.value === draft.templateToken ? draft.variables : {} });
                  }}
                >
                  <option value="">{templatesQ.isLoading ? 'Carregando...' : 'Escolha o modelo'}</option>
                  {templates.map((t) => (
                    <option key={t.token} value={t.token}>
                      {t.name}
                    </option>
                  ))}
                </NativeSelect>
                {templatesQ.error ? <p className="mt-1 text-[11px] text-red-600">{(templatesQ.error as Error).message}</p> : null}
              </div>

              {draft.templateToken ? (
                <div>
                  <p className={LABEL}>Variáveis do modelo</p>
                  {varsQ.isLoading ? (
                    <p className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                      <Loader2 size={12} className="animate-spin" aria-hidden="true" /> Lendo o modelo...
                    </p>
                  ) : varsQ.error ? (
                    <p className="text-xs text-red-600">{(varsQ.error as Error).message}</p>
                  ) : variables.length === 0 ? (
                    <p className="text-xs text-slate-500">{varsQ.data?.note ?? 'Este modelo não tem variáveis entre chaves. O documento vai como está.'}</p>
                  ) : (
                    <VariableMappingTable variables={variables} mapping={draft.variables} onChange={(v) => set({ variables: v })} sources={sources} />
                  )}
                </div>
              ) : null}

              <div>
                <label htmlFor={`sig-doc-${stageId}`} className={LABEL}>
                  Nome do documento na ZapSign
                </label>
                <input id={`sig-doc-${stageId}`} className={FIELD} value={draft.docName} onChange={(e) => set({ docName: e.target.value })} placeholder={`${draft.templateName || 'Documento'} - {{contato.nome}}`} />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={`sig-send-${stageId}`} className={LABEL}>
                    Como o cliente recebe o link
                  </label>
                  <NativeSelect id={`sig-send-${stageId}`} className={FIELD} value={draft.send} onChange={(e) => set({ send: e.target.value })}>
                    {SEND_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </NativeSelect>
                  <p className="mt-1 text-[11px] text-slate-500">{SEND_OPTIONS.find((o) => o.value === draft.send)?.hint}</p>
                </div>
                <div>
                  <label htmlFor={`sig-auth-${stageId}`} className={LABEL}>
                    Como o cliente comprova quem é
                  </label>
                  <NativeSelect id={`sig-auth-${stageId}`} className={FIELD} value={draft.authMode} onChange={(e) => set({ authMode: e.target.value })}>
                    {AUTH_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </NativeSelect>
                  <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-slate-600 dark:text-slate-300">
                    <label className="inline-flex items-center gap-1.5">
                      <input type="checkbox" className="h-3.5 w-3.5 accent-primary-600" checked={draft.requireCpf} onChange={(e) => set({ requireCpf: e.target.checked })} /> Pedir CPF
                    </label>
                    <label className="inline-flex items-center gap-1.5">
                      <input type="checkbox" className="h-3.5 w-3.5 accent-primary-600" checked={draft.requireSelfie} onChange={(e) => set({ requireSelfie: e.target.checked })} /> Pedir selfie
                    </label>
                    <label className="inline-flex items-center gap-1.5">
                      <input type="checkbox" className="h-3.5 w-3.5 accent-primary-600" checked={draft.allowRefuse} onChange={(e) => set({ allowRefuse: e.target.checked })} /> Pode recusar
                    </label>
                  </div>
                </div>
              </div>

              {draft.send === 'crm_whatsapp' ? (
                <div>
                  <label htmlFor={`sig-msg-${stageId}`} className={LABEL}>
                    Mensagem no WhatsApp
                  </label>
                  <textarea id={`sig-msg-${stageId}`} className={`${FIELD} resize-y`} rows={2} maxLength={1000} value={draft.message} onChange={(e) => set({ message: e.target.value })} />
                  <p className="mt-1 text-[11px] text-slate-500">Variáveis: {'{{nome}}'}, {'{{primeiro_nome}}'}, {'{{documento}}'}, {'{{link}}'}. Na API oficial da Meta, só dentro de 24 h da última mensagem do lead.</p>
                </div>
              ) : null}

              <details className="rounded-lg border border-slate-200 dark:border-white/10 p-3">
                <summary className="cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-200">Outro signatário (advogado, testemunha)</summary>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <input className={FIELD} placeholder="Nome" value={draft.extraName} onChange={(e) => set({ extraName: e.target.value })} aria-label="Nome do outro signatário" />
                  <input className={FIELD} placeholder="E-mail (recebe o link por e-mail)" value={draft.extraEmail} onChange={(e) => set({ extraEmail: e.target.value })} aria-label="E-mail do outro signatário" />
                  <input className={FIELD} placeholder="Telefone" value={draft.extraPhone} onChange={(e) => set({ extraPhone: e.target.value })} aria-label="Telefone do outro signatário" />
                  <input className={FIELD} placeholder="Qualificação (ex.: Advogado)" value={draft.extraQualification} onChange={(e) => set({ extraQualification: e.target.value })} aria-label="Qualificação do outro signatário" />
                </div>
              </details>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-500/30 p-3 space-y-2">
                  <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">Quando assinar</p>
                  <NativeSelect className={FIELD} value={draft.signedStage} onChange={(e) => set({ signedStage: e.target.value })} aria-label="Mover para a etapa ao assinar">
                    <option value="">Não mover de etapa</option>
                    {stageOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        Mover para {s.label}
                      </option>
                    ))}
                  </NativeSelect>
                  <input className={FIELD} placeholder="Adicionar etiqueta (opcional)" value={draft.signedTag} onChange={(e) => set({ signedTag: e.target.value })} aria-label="Etiqueta ao assinar" />
                  <NativeSelect className={FIELD} value={draft.signedBot} onChange={(e) => set({ signedBot: e.target.value })} aria-label="Robô ao assinar">
                    <option value="">Não iniciar robô</option>
                    {(botsQ.data ?? []).map((b) => (
                      <option key={b.id} value={b.id}>
                        Iniciar robô: {b.name}
                        {b.enabled ? '' : ' (desligado)'}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="rounded-lg border border-red-200 dark:border-red-500/30 p-3 space-y-2">
                  <p className="text-xs font-semibold text-red-700 dark:text-red-300">Quando recusar</p>
                  <NativeSelect className={FIELD} value={draft.refusedStage} onChange={(e) => set({ refusedStage: e.target.value })} aria-label="Mover para a etapa ao recusar">
                    <option value="">Não mover de etapa</option>
                    {stageOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        Mover para {s.label}
                      </option>
                    ))}
                  </NativeSelect>
                  <input className={FIELD} placeholder="Adicionar etiqueta (opcional)" value={draft.refusedTag} onChange={(e) => set({ refusedTag: e.target.value })} aria-label="Etiqueta ao recusar" />
                </div>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Cada documento criado conta na franquia do plano ZapSign, mesmo sem assinatura. Quando o cliente assina, o PDF entra nos
                anexos do lead e o histórico registra.
              </p>
            </div>
          ) : null}

          {q.data?.rule?.enabled && q.data.stats ? (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {q.data.stats.pending} aguardando assinatura, {q.data.stats.signed} assinado(s) nesta etapa.
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
              Salvar assinatura
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export default StageSignatureSection;
