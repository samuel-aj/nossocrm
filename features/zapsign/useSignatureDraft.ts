'use client';

/**
 * Rascunho de um envio para assinatura: o que vai no documento (modelo, nome,
 * valor de cada variável), como o cliente recebe e como comprova quem é.
 * Começa com a regra da etapa (a atual do lead ou a de destino do movimento)
 * e com os dados do lead já resolvidos; a pessoa confere e ajusta antes de
 * enviar. Usado pela aba Contrato e pelo modal de conferência ao mudar de
 * etapa. Puro estado + consultas; a apresentação fica em SignatureFields.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SourceOption } from '@/lib/zapsign/variables';
import { DEFAULT_SIGN_MESSAGE, useZapSignTemplateVariables, useZapSignTemplates } from './useZapSign';

export type SendPrep = {
  connected: boolean;
  sandbox: boolean;
  stage_id: string | null;
  rule: {
    enabled: boolean;
    template_token: string;
    template_name: string | null;
    doc_name: string | null;
    variables: Record<string, string>;
    signer: { auth_mode?: string; require_cpf?: boolean; require_selfie_photo?: boolean; send?: string; message?: string; allow_refuse?: boolean } | null;
    extra_signers: Array<{ name: string; email?: string; phone?: string; qualification?: string }>;
    on_signed: Record<string, unknown> | null;
    on_refused: Record<string, unknown> | null;
  } | null;
  review: { id: string; created_at: string } | null;
  existing: { id: string; status: string; doc_name: string | null; template_name: string | null; sent_at: string | null; signed_at: string | null; created_at: string } | null;
  contact: { name: string; email: string; phone: string };
  whatsapp: { ok: boolean; reason: string | null };
  sources: SourceOption[];
  preview: Record<string, string>;
};

export type DraftForm = {
  templateToken: string;
  docName: string;
  /** variável -> origem ("contato.nome", "campo:cpf", "texto:...", "") */
  mapping: Record<string, string>;
  /** variável -> texto digitado por cima do valor resolvido */
  overrides: Record<string, string>;
  send: string;
  authMode: string;
  requireCpf: boolean;
  message: string;
  allowEmpty: boolean;
};

export type DraftIssue = { kind: 'block' | 'warn'; text: string };

const EMPTY: DraftForm = {
  templateToken: '',
  docName: '',
  mapping: {},
  overrides: {},
  send: 'crm_whatsapp',
  authMode: 'assinaturaTela',
  requireCpf: false,
  message: DEFAULT_SIGN_MESSAGE,
  allowEmpty: false,
};

export const sendPrepKey = (dealId: string, stageId: string | null | undefined) => ['zapsign', 'send-prep', dealId, stageId ?? ''] as const;

export function useSignatureDraft({ dealId, stageId, enabled = true }: { dealId: string; stageId?: string | null; enabled?: boolean }) {
  const prep = useQuery<SendPrep>({
    queryKey: sendPrepKey(dealId, stageId),
    enabled,
    queryFn: async () => {
      const qs = new URLSearchParams({ deal_id: dealId });
      if (stageId) qs.set('stage_id', stageId);
      const res = await fetch(`/api/integrations/zapsign/send?${qs.toString()}`, { credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      return body as SendPrep;
    },
    staleTime: 0,
    retry: false,
  });
  const templatesQ = useZapSignTemplates(enabled);
  const [form, setForm] = useState<DraftForm>(EMPTY);
  const [seeded, setSeeded] = useState(false);
  const varsQ = useZapSignTemplateVariables(enabled && form.templateToken ? form.templateToken : null);

  // Padrão: a regra da etapa (uma vez, quando os dados chegam)
  useEffect(() => {
    const data = prep.data;
    if (!data || seeded) return;
    const r = data.rule;
    setSeeded(true);
    if (!r) return;
    setForm((f) => ({
      ...f,
      templateToken: r.template_token,
      docName: r.doc_name ?? '',
      mapping: r.variables ?? {},
      send: r.signer?.send ?? 'crm_whatsapp',
      authMode: r.signer?.auth_mode ?? 'assinaturaTela',
      requireCpf: !!r.signer?.require_cpf,
      message: r.signer?.message || DEFAULT_SIGN_MESSAGE,
    }));
  }, [prep.data, seeded]);

  // Variáveis do modelo que a regra não mapeou entram com a sugestão
  useEffect(() => {
    const v = varsQ.data;
    if (!v) return;
    setForm((f) => {
      const next = { ...f.mapping };
      let changed = false;
      for (const name of v.variables) {
        if (!(name in next)) {
          next[name] = v.suggestions[name] ?? '';
          changed = true;
        }
      }
      return changed ? { ...f, mapping: next } : f;
    });
  }, [varsQ.data]);

  const set = useCallback((patch: Partial<DraftForm>) => setForm((f) => ({ ...f, ...patch })), []);
  const setSource = useCallback((name: string, source: string) => {
    setForm((f) => {
      const overrides = { ...f.overrides };
      delete overrides[name];
      return { ...f, mapping: { ...f.mapping, [name]: source }, overrides };
    });
  }, []);
  const setValue = useCallback((name: string, value: string | null) => {
    setForm((f) => {
      const overrides = { ...f.overrides };
      if (value === null) delete overrides[name];
      else overrides[name] = value;
      return { ...f, overrides };
    });
  }, []);
  const chooseTemplate = useCallback(
    (token: string) => {
      const rule = prep.data?.rule;
      setForm((f) => ({
        ...f,
        templateToken: token,
        mapping: token === rule?.template_token ? (rule?.variables ?? {}) : {},
        overrides: {},
        allowEmpty: false,
      }));
    },
    [prep.data]
  );

  const templates = useMemo(() => templatesQ.data?.templates ?? [], [templatesQ.data]);
  const templateName = useMemo(
    () => templates.find((t) => t.token === form.templateToken)?.name ?? (form.templateToken === prep.data?.rule?.template_token ? prep.data?.rule?.template_name ?? '' : ''),
    [templates, form.templateToken, prep.data]
  );
  const variables = useMemo(() => varsQ.data?.variables ?? [], [varsQ.data]);

  /** Valor final de cada variável (o que vai para o documento). */
  const values = useMemo(() => {
    const out: Record<string, string> = {};
    const preview = prep.data?.preview ?? {};
    for (const name of variables) {
      const src = form.mapping[name] ?? '';
      out[name] = name in form.overrides ? form.overrides[name] : src.startsWith('texto:') ? src.slice(6) : (preview[src] ?? '');
    }
    return out;
  }, [variables, form.mapping, form.overrides, prep.data]);
  const emptyVars = useMemo(() => variables.filter((v) => !(values[v] ?? '').trim()), [variables, values]);

  const contact = prep.data?.contact;
  const issues = useMemo<DraftIssue[]>(() => {
    const list: DraftIssue[] = [];
    if (prep.data && !contact?.name) list.push({ kind: 'block', text: 'O lead precisa de um contato com nome para assinar.' });
    if (prep.data && form.send === 'zapsign_whatsapp' && !contact?.phone) list.push({ kind: 'block', text: 'O contato não tem telefone. Escolha outro jeito de enviar o link.' });
    if (prep.data && form.send === 'zapsign_email' && !contact?.email) list.push({ kind: 'block', text: 'O contato não tem e-mail. Escolha outro jeito de enviar o link.' });
    if (prep.data && form.send === 'crm_whatsapp' && !prep.data.whatsapp.ok) list.push({ kind: 'warn', text: `O link não vai sair pelo WhatsApp do CRM (${prep.data.whatsapp.reason ?? 'sem conversa'}). O documento é criado e o link fica no lead.` });
    if (form.templateToken && !varsQ.isLoading && !varsQ.error && variables.length === 0 && varsQ.data?.note) list.push({ kind: 'warn', text: varsQ.data.note });
    return list;
  }, [prep.data, contact, form.send, form.templateToken, varsQ.isLoading, varsQ.error, varsQ.data, variables.length]);

  const blocked = issues.some((i) => i.kind === 'block');
  const ready = !!prep.data && !!form.templateToken && !varsQ.isLoading && !varsQ.error && !blocked && (emptyVars.length === 0 || form.allowEmpty);

  /** Corpo do POST /api/integrations/zapsign/send (sem deal_id e rule_stage_id). */
  const payload = useCallback(() => {
    const rule = prep.data?.rule;
    const vars: Record<string, string> = {};
    for (const name of variables) vars[name] = form.mapping[name] ?? '';
    const overrides: Record<string, string> = {};
    for (const name of variables) if (name in form.overrides) overrides[name] = form.overrides[name];
    return {
      template_token: form.templateToken,
      template_name: templateName || null,
      doc_name: form.docName.trim() || null,
      variables: vars,
      overrides,
      signer: { send: form.send, auth_mode: form.authMode, require_cpf: form.requireCpf, message: form.message, allow_refuse: rule?.signer?.allow_refuse ?? true },
      extra_signers: rule?.extra_signers ?? [],
      on_signed: rule?.on_signed ?? {},
      on_refused: rule?.on_refused ?? {},
    };
  }, [prep.data, variables, form, templateName]);

  const reset = useCallback(() => {
    setForm(EMPTY);
    setSeeded(false);
  }, []);

  return { prep, templatesQ, varsQ, templates, templateName, form, set, setSource, setValue, chooseTemplate, variables, values, emptyVars, issues, blocked, ready, payload, reset };
}

export type SignatureDraft = ReturnType<typeof useSignatureDraft>;
