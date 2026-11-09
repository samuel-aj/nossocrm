'use client';

import { fullSignerName, identityFromForm, signerEmail, signerField, signerPhone, type SignerIdentity } from '@/lib/zapsign/signerIdentity';

/**
 * Rascunho de um envio para assinatura: o que vai no documento (modelo, nome,
 * valor de cada variável), como o cliente recebe e como comprova quem é.
 * Começa com a regra da etapa (a atual do lead ou a de destino do movimento)
 * e com os dados do lead já resolvidos; a pessoa confere e ajusta antes de
 * enviar. Usado pela aba Contrato e pelo modal de conferência ao mudar de
 * etapa. Puro estado + consultas; a apresentação fica em SignatureFields.
 *
 * IA: com o modelo escolhido, a IA da organização lê a conversa, as ligações
 * e as notas do lead e preenche as variáveis sozinha (uma vez por modelo; o
 * resultado fica 10 min em cache). O que ela mudou fica marcado com a origem;
 * o que a pessoa digitar depois ganha da IA.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  identityEdits: Partial<SignerIdentity>;
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

export type AiFillField = { name: string; value: string; origin: 'conversa' | 'ligacao' | 'lead'; evidence: string; changed: boolean };
export type AiFillResponse = { fields: AiFillField[]; used: { messages: number; audios: number; calls: number; notes: number }; notes: string[]; model: string };
export type AiFillState = {
  status: 'idle' | 'running' | 'done' | 'error';
  /** Modelo para o qual a IA rodou (ou está rodando). */
  token: string;
  error: string | null;
  code: string | null;
  result: AiFillResponse | null;
  /** Variáveis que a IA preencheu e ainda estão como ela deixou. */
  applied: Record<string, AiFillField>;
};

const AI_IDLE: AiFillState = { status: 'idle', token: '', error: null, code: null, result: null, applied: {} };
const AI_CACHE_MS = 10 * 60_000;

export const aiFillKey = (dealId: string, templateToken: string) => ['zapsign', 'ai-fill', dealId, templateToken] as const;

async function postAiFill(body: unknown): Promise<AiFillResponse> {
  const res = await fetch('/api/integrations/zapsign/ai-fill', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string } & Partial<AiFillResponse>;
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`) as Error & { code?: string };
    err.code = data.code;
    throw err;
  }
  return data as AiFillResponse;
}

const EMPTY: DraftForm = {
  identityEdits: {},
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

export function useSignatureDraft({ dealId, stageId, enabled = true, autoAi = true }: { dealId: string; stageId?: string | null; enabled?: boolean; autoAi?: boolean }) {
  const qc = useQueryClient();
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
  const [ai, setAi] = useState<AiFillState>(AI_IDLE);
  const editVersions = useRef(new Map<string, number>());
  const tokenRef = useRef('');
  tokenRef.current = form.templateToken;
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
  /** A pessoa mexeu na variável: o valor deixa de ser "da IA". */
  const forgetAi = useCallback((name: string) => {
    editVersions.current.set(name, (editVersions.current.get(name) ?? 0) + 1);
    setAi((a) => {
      if (!(name in a.applied)) return a;
      const applied = { ...a.applied };
      delete applied[name];
      return { ...a, applied };
    });
  }, []);
  const setSource = useCallback(
    (name: string, source: string) => {
      forgetAi(name);
      setForm((f) => {
        const overrides = { ...f.overrides };
        delete overrides[name];
        return { ...f, mapping: { ...f.mapping, [name]: source }, overrides };
      });
    },
    [forgetAi]
  );
  const setValue = useCallback(
    (name: string, value: string | null) => {
      forgetAi(name);
      setForm((f) => {
        const overrides = { ...f.overrides };
        if (value === null) delete overrides[name];
        else overrides[name] = value;
        return { ...f, overrides };
      });
    },
    [forgetAi]
  );
  const chooseTemplate = useCallback(
    (token: string) => {
      const rule = prep.data?.rule;
      setForm((f) => ({
        ...f,
        templateToken: token,
        mapping: token === rule?.template_token ? (rule?.variables ?? {}) : {},
        overrides: {},
        identityEdits: {},
        allowEmpty: false,
      }));
      setAi(AI_IDLE);
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
  const emptyVars = useMemo(() => variables.filter((v) => !values[v]?.trim() && signerField(v, form.mapping[v]) !== 'email'), [variables, values, form.mapping]);
  const contact = prep.data?.contact;
  const identity = useMemo(() => identityFromForm(values, form.mapping, {
    name: contact?.name ?? '', phone: contact?.phone ?? '', email: signerEmail(contact?.email ?? ''), ...form.identityEdits,
  }), [values, form.mapping, form.identityEdits, contact]);
  const editIdentity = (field: keyof SignerIdentity, value: string) => {
    const matching = variables.filter(name => signerField(name, form.mapping[name]) === field);
    matching.forEach(forgetAi);
    setForm(f => ({ ...f, identityEdits: { ...f.identityEdits, [field]: value },
      overrides: { ...f.overrides, ...Object.fromEntries(matching.map(name => [name, value])) } }));
  };

  /**
   * Roda a IA para o modelo atual. `force` ignora o cache (botão "Preencher de
   * novo"). O valor de partida de cada variável é o que a tela mostra sem as
   * sugestões anteriores da IA; o que a pessoa digitou conta como valor atual
   * e não é trocado.
   */
  const runAi = useCallback(
    async (force = false) => {
      const token = form.templateToken;
      const data = prep.data;
      if (!token || !data || variables.length === 0) return;
      const labels = new Map(data.sources.map((s) => [s.value, s.label]));
      const typed = new Set(Object.keys(form.overrides).filter((n) => !(n in ai.applied)));
      const versionsAtStart = new Map(editVersions.current);
      const editedDuringRequest = (name: string) => versionsAtStart.get(name) !== editVersions.current.get(name);
      const payloadVars = variables.map((name) => {
        const src = form.mapping[name] ?? '';
        const crm = src.startsWith('texto:') ? src.slice(6) : (data.preview[src] ?? '');
        return {
          name,
          current: typed.has(name) ? form.overrides[name] : crm,
          source: typed.has(name) ? 'digitado na tela' : src.startsWith('texto:') ? 'texto fixo' : src ? (labels.get(src) ?? src) : '',
        };
      });
      setAi((a) => ({ ...a, status: 'running', token, error: null, code: null }));
      const key = aiFillKey(dealId, token);
      if (force) qc.removeQueries({ queryKey: key, exact: true });
      try {
        const res = await qc.fetchQuery({
          queryKey: key,
          queryFn: () => postAiFill({ deal_id: dealId, template_name: templateName || null, variables: payloadVars }),
          staleTime: AI_CACHE_MS,
          gcTime: AI_CACHE_MS,
          retry: false,
        });
        if (tokenRef.current !== token) return;
        const applied: Record<string, AiFillField> = {};
        const patch: Record<string, string> = {};
        for (const f of res.fields) {
          // Texto fixo do modelo e o que a pessoa digitou não mudam
          if ((form.mapping[f.name] ?? '').startsWith('texto:') || typed.has(f.name) || editedDuringRequest(f.name) || !f.changed) continue;
          patch[f.name] = f.value;
          applied[f.name] = f;
        }
        // O que a IA tinha posto antes e agora não pôs volta ao valor do CRM
        const previous = Object.keys(ai.applied);
        setForm((f) => {
          const overrides = { ...f.overrides };
          for (const n of previous) if (!(n in patch) && !editedDuringRequest(n)) delete overrides[n];
          return { ...f, overrides: { ...overrides, ...patch } };
        });
        setAi({ status: 'done', token, error: null, code: null, result: res, applied });
      } catch (err) {
        if (tokenRef.current !== token) return;
        setAi((a) => ({ ...a, status: 'error', token, error: err instanceof Error ? err.message : 'A IA não conseguiu preencher.', code: (err as { code?: string }).code ?? null }));
      }
    },
    [form.templateToken, form.mapping, form.overrides, prep.data, variables, ai.applied, dealId, templateName, qc]
  );

  // Sozinha, uma vez por modelo, quando o modelo e as variáveis já chegaram
  const mappingReady = variables.length > 0 && variables.every((n) => n in form.mapping);
  useEffect(() => {
    if (!enabled || !autoAi || !prep.data?.connected || !form.templateToken || !mappingReady) return;
    if (ai.token === form.templateToken) return;
    void runAi(false);
  }, [enabled, autoAi, prep.data, form.templateToken, mappingReady, ai.token, runAi]);

  const issues = useMemo<DraftIssue[]>(() => {
    const list: DraftIssue[] = [];
    if (prep.data && !fullSignerName(identity.name)) list.push({ kind: 'block', text: 'Informe o nome completo de quem vai assinar.' });
    const requiresPhone = form.send === 'zapsign_whatsapp' || ['tokenWhatsapp', 'tokenSms'].includes(form.authMode);
    if (prep.data && (identity.phone || requiresPhone) && !signerPhone(identity.phone)) list.push({ kind: 'block', text: 'Confira o telefone com DDD de quem vai assinar.' });
    if (prep.data && (form.send === 'zapsign_email' || form.authMode === 'tokenEmail') && !signerEmail(identity.email)) list.push({ kind: 'block', text: 'Para continuar sem e-mail, escolha outra forma de envio e de autenticação.' });
    else if (prep.data && identity.email.trim() && !signerEmail(identity.email)) list.push({ kind: 'warn', text: 'Esse e-mail será omitido na assinatura. Você pode corrigi-lo aqui.' });
    if (prep.data && form.send === 'crm_whatsapp' && !prep.data.whatsapp.ok) list.push({ kind: 'warn', text: `O link não vai sair pelo WhatsApp do CRM (${prep.data.whatsapp.reason ?? 'sem conversa'}). O documento é criado e o link fica no lead.` });
    if (form.templateToken && !varsQ.isLoading && !varsQ.error && variables.length === 0 && varsQ.data?.note) list.push({ kind: 'warn', text: varsQ.data.note });
    return list;
  }, [prep.data, identity, form.authMode, form.send, form.templateToken, varsQ.isLoading, varsQ.error, varsQ.data, variables.length]);

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
      confirmed_signer: { name: identity.name.trim(), phone: signerPhone(identity.phone), email: signerEmail(identity.email) },
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
  }, [prep.data, variables, form, templateName, identity]);

  const reset = useCallback(() => {
    setForm(EMPTY);
    setSeeded(false);
    setAi(AI_IDLE);
  }, []);

  return { prep, templatesQ, varsQ, templates, templateName, form, set, setSource, setValue, chooseTemplate, variables, values, identity, editIdentity, emptyVars, issues, blocked, ready, payload, reset, ai, runAi };
}

export type SignatureDraft = ReturnType<typeof useSignatureDraft>;
